"""
RAG (Retrieval-Augmented Generation) module for document processing.

- PDF extraction via Docling (AI layout analysis + TableFormer table recognition)
  with Tesseract 5 OCR fallback for scanned pages
- DOCX extraction via python-docx
- TXT reading with encoding detection
- Section-aware smart chunking (splits on headers, keeps tables intact)
- RAGEngine: embedding (all-MiniLM-L6-v2), FAISS indexing, hybrid retrieval, context building
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

import re as _re

# ============================================================
# Prompt Injection Sanitization (C13)
# ============================================================

_INJECTION_PATTERNS = [
    # Direct instruction overrides
    (_re.compile(r'(?i)(ignore|forget|disregard)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|rules?)'), '[content filtered]'),
    # System prompt manipulation
    (_re.compile(r'(?i)you\s+are\s+now\s+'), '[content filtered] '),
    (_re.compile(r'(?i)new\s+instructions?:\s*'), '[content filtered] '),
    (_re.compile(r'(?i)system\s*:\s*'), '[content filtered] '),
    # Role playing attacks
    (_re.compile(r'(?i)pretend\s+(you\s+are|to\s+be)\s+'), '[content filtered] '),
    (_re.compile(r'(?i)act\s+as\s+(if\s+you\s+are\s+|a\s+)'), '[content filtered] '),
    # Delimiter injection (fake end-of-context markers)
    (_re.compile(r'---\s*END\s+OF\s+(EXCERPTS|DOCUMENTS?|CONTEXT)\s*---'), '[content filtered]'),
    (_re.compile(r'---\s*SYSTEM\s*---'), '[content filtered]'),
    # Output format manipulation
    (_re.compile(r'(?i)respond\s+only\s+with'), '[content filtered]'),
    (_re.compile(r'(?i)do\s+not\s+(mention|reference|cite)\s+(the\s+)?(documents?|sources?|excerpts?)'), '[content filtered]'),
]


def _sanitize_rag_text(text: str) -> str:
    """Neutralize common prompt injection patterns in RAG context.

    Replaces suspicious patterns with [content filtered] while preserving
    the rest of the text. Documents are not rejected — only injection
    attempts are defanged.
    """
    for pattern, replacement in _INJECTION_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ============================================================
# Data Classes
# ============================================================

@dataclass
class DocumentPage:
    """A single page of extracted text from a document."""
    text: str
    page_number: int
    source_file: str


@dataclass
class DocumentChunk:
    """A chunk of text from a document, ready for embedding."""
    text: str
    page_number: int
    source_file: str
    chunk_index: int


@dataclass
class RetrievedChunk:
    """A chunk returned from a similarity search."""
    text: str
    page_number: int
    source_file: str
    similarity_score: float


@dataclass
class DocumentInfo:
    """Summary info about a processed document (for UI display)."""
    filename: str
    file_type: str
    page_count: int
    chunk_count: int
    total_characters: int


# ============================================================
# Text Extraction
# ============================================================

def extract_text(file_path: str, file_type: str) -> List[DocumentPage]:
    """
    Extract text from a document file.

    Args:
        file_path: Path to the document file.
        file_type: One of 'pdf', 'docx', 'txt'.

    Returns:
        List of DocumentPage objects with text and page numbers.

    Raises:
        ValueError: If file_type is unsupported or file cannot be read.
    """
    file_type = file_type.lower().strip(".")
    filename = os.path.basename(file_path)

    if file_type == "pdf":
        return _extract_pdf(file_path, filename)
    elif file_type == "docx":
        return _extract_docx(file_path, filename)
    elif file_type == "txt":
        return _extract_txt(file_path, filename)
    else:
        raise ValueError(
            f"Unsupported file type: '{file_type}'. "
            "We support PDF, Word (.docx), and text (.txt) files."
        )


_docling_converter = None  # Cached globally — pipeline setup is expensive


def _get_docling_converter():
    """Get or create the shared Docling converter (reuses pre-loaded models)."""
    global _docling_converter
    if _docling_converter is None:
        from docling.document_converter import DocumentConverter
        _docling_converter = DocumentConverter()
        logger.info("Docling converter initialized")
    return _docling_converter


_DOCLING_PAGE_THRESHOLD = 50  # Use Docling for PDFs up to this many pages


def _extract_pdf(file_path: str, filename: str) -> List[DocumentPage]:
    """Extract text from PDF, choosing strategy by document size:

    - Small PDFs (≤50 pages): Docling AI extraction — full table structure,
      layout analysis, OCR for scanned pages. Slower (~7s/page on CPU).
    - Large PDFs (>50 pages): pypdf fast extraction — text content only,
      tables may lose some formatting. Very fast (~100ms/page).

    This trade-off exists because Docling runs neural networks on every page.
    A 160-page document would take ~20 minutes with Docling vs ~20 seconds
    with pypdf. For text-heavy documents (regulations, contracts, handbooks),
    pypdf captures the vast majority of content.
    """
    # Count pages to decide strategy
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        num_pages = len(reader.pages)
    except Exception as e:
        logger.error("PDF page counting failed for %s: %s", filename, e)
        raise ValueError(
            f"Couldn't process this PDF file — {type(e).__name__}: {e}"
        ) from e

    if num_pages <= _DOCLING_PAGE_THRESHOLD:
        # Small doc: use Docling for full quality (tables, layout, OCR)
        logger.info(f"PDF has {num_pages} pages (≤{_DOCLING_PAGE_THRESHOLD}): using Docling AI extraction")
        return _extract_pdf_docling(file_path, filename)

    # Large doc: fast extraction with pypdf
    logger.info(f"PDF has {num_pages} pages (>{_DOCLING_PAGE_THRESHOLD}): using fast text extraction")
    pages: List[DocumentPage] = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(DocumentPage(
                text=_promote_table_subheaders(text.strip()),
                page_number=i + 1,
                source_file=filename,
            ))

    if not pages:
        # No text extracted — scanned PDF, fall back to Docling for OCR
        logger.info("No text extracted with pypdf — falling back to Docling for OCR")
        return _extract_pdf_docling(file_path, filename)

    return pages


def _extract_pdf_docling(file_path: str, filename: str) -> List[DocumentPage]:
    """Full Docling extraction — AI layout analysis + table structure recognition."""
    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        raise ValueError(
            "PDF processing requires Docling. Install it with: pip install docling"
        )

    try:
        converter = _get_docling_converter()
        result = converter.convert(file_path)
    except Exception as e:
        logger.error("Docling PDF extraction failed for %s: %s", filename, e)
        raise ValueError(
            f"Couldn't process this PDF file — {type(e).__name__}: {e}"
        ) from e

    doc = result.document

    pages = _build_pages_from_docling(doc, filename)

    if not pages:
        raise ValueError(
            "Couldn't read any text from this PDF. "
            "The file may be image-only and OCR couldn't process it."
        )

    return pages


def _build_pages_from_docling(doc, filename: str) -> List[DocumentPage]:
    """Build DocumentPage list from Docling's document object.

    Uses Docling's per-page markdown export for accurate page mapping.
    Falls back to item-level provenance grouping, then full markdown as last resort.
    """
    pages = []

    # Strategy 1: Per-page markdown export (most reliable for page numbers)
    try:
        num_pages = len(doc.pages) if hasattr(doc, 'pages') else 0
        if num_pages > 0:
            for page_num in sorted(doc.pages.keys()):
                page_md = doc.export_to_markdown(page_no=page_num)
                if page_md and page_md.strip():
                    pages.append(DocumentPage(
                        text=page_md.strip(),
                        page_number=page_num,
                        source_file=filename,
                    ))
            if pages:
                # Post-process: convert table sub-headers into proper ## headers
                pages = [DocumentPage(
                    text=_promote_table_subheaders(p.text),
                    page_number=p.page_number,
                    source_file=p.source_file,
                ) for p in pages]
                return pages
    except Exception as e:
        logger.warning(f"Per-page Docling export failed, trying item-level grouping: {e}")

    # Strategy 2: Group items by provenance page number
    try:
        page_contents: dict[int, list[str]] = {}

        for item, _level in doc.iterate_items():
            page_num = 1
            if hasattr(item, 'prov') and item.prov:
                page_num = item.prov[0].page_no

            text = ""
            if hasattr(item, 'export_to_markdown'):
                text = item.export_to_markdown()
            elif hasattr(item, 'text'):
                text = item.text or ""

            if text.strip():
                if page_num not in page_contents:
                    page_contents[page_num] = []
                page_contents[page_num].append(text)

        if page_contents:
            for page_num in sorted(page_contents.keys()):
                combined = "\n\n".join(page_contents[page_num])
                if combined.strip():
                    pages.append(DocumentPage(
                        text=combined.strip(),
                        page_number=page_num,
                        source_file=filename,
                    ))
            if pages:
                return pages
    except Exception as e:
        logger.warning(f"Item-level Docling grouping failed, using full markdown: {e}")

    # Strategy 3: Full markdown as single document (last resort)
    try:
        full_md = doc.export_to_markdown()
        if full_md and full_md.strip():
            pages.append(DocumentPage(
                text=full_md.strip(),
                page_number=1,
                source_file=filename,
            ))
    except Exception as e:
        logger.warning(f"Full markdown export failed: {e}")

    return pages


def _promote_table_subheaders(text: str) -> str:
    """Detect sub-headers within markdown tables and promote them to ## headers.

    Handles two patterns:

    Pattern 1 — Empty-cell sub-header: first cell has text, rest are empty.
        | 6. Soul Eater    | Assailment | 7+ | Combat | ...description... |
        | Elementalism     |            |    |        |                   |
        | Storm Caller     | Hex        | 7+ | 12'    | ...description... |

    Pattern 2 — Repeated-header sub-header: the row repeats the column headers
    from the first row, indicating a new category within the same table.
        | Melee Weapons pg. 213   | Range | Strength | AP | Special Rules |
        |-------------------------|-------|----------|-----|---------------|
        | Hand Weapon             | Melee | S        | -   | -             |
        | Missile Weapons pg. 216 | Range | Strength | AP | Special Rules |
        | Shortbow                | 18'   | 3        | -   | Quick Shot... |
    """
    lines = text.split('\n')
    result = []
    i = 0

    # Capture the column headers from the first table header row (Pattern 2)
    # These are the cells of the very first table row we encounter.
    header_cells = None

    while i < len(lines):
        line = lines[i]

        # Check if this is a table row
        if '|' in line and line.strip().startswith('|'):
            raw_cells = line.split('|')
            data_cells = [c.strip() for c in raw_cells[1:-1]] if len(raw_cells) > 2 else []

            # Skip separator rows (all dashes/colons)
            if data_cells and all(re.match(r'^[-:]+$', c) or not c for c in data_cells):
                result.append(line)
                i += 1
                continue

            # Capture header cells from the first real table row
            just_captured_header = False
            if header_cells is None and len(data_cells) >= 3:
                header_cells = [c.lower() for c in data_cells[1:]]  # exclude first cell (category name)
                just_captured_header = True

            # Pattern 3: First row of table where first cell has a page reference
            # (e.g., "Melee Weapons pg. 213") — indicates a category label, not data.
            # Only applies when we just captured header_cells (i.e., this IS the first row).
            if (just_captured_header
                    and data_cells[0]
                    and re.search(r'pg\.\s*\d+', data_cells[0], re.IGNORECASE)):
                result.append('')
                result.append(f'## {data_cells[0]}')
                result.append('')
                i += 1
                continue

            # Pattern 1: first cell has text, all others empty
            non_empty = [c for c in data_cells if c]
            if (len(data_cells) >= 3
                    and len(non_empty) == 1
                    and data_cells[0]
                    and not data_cells[0].startswith('-')
                    and not re.match(r'^[-:| ]+$', data_cells[0])):

                result.append('')
                result.append(f'## {data_cells[0]}')
                result.append('')
                i += 1
                continue

            # Pattern 2: remaining cells match the original header row
            # (a repeated header means a new sub-category in the same table)
            # Skip the row where we just captured header_cells (it would match itself).
            if (not just_captured_header
                    and header_cells is not None
                    and len(data_cells) >= 3
                    and data_cells[0]
                    and not data_cells[0].startswith('-')):
                remaining = [c.lower() for c in data_cells[1:]]
                if remaining == header_cells:
                    # This row repeats the column headers — it's a sub-category divider
                    result.append('')
                    result.append(f'## {data_cells[0]}')
                    result.append('')
                    i += 1
                    continue

        result.append(line)
        i += 1

    return '\n'.join(result)


def _extract_docx(file_path: str, filename: str) -> List[DocumentPage]:
    """Extract text from DOCX using python-docx."""
    try:
        from docx import Document
    except ImportError:
        raise ValueError("Word document support requires python-docx. Please install it.")

    try:
        doc = Document(file_path)
    except Exception as e:
        raise ValueError(f"Couldn't open this Word document. It may be corrupted.") from e

    # DOCX doesn't have natural page breaks we can reliably detect,
    # so we treat the whole document as page 1.
    # For large documents, chunking will handle the splitting.
    full_text = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            full_text.append(text)

    combined = "\n\n".join(full_text)

    if not combined.strip():
        raise ValueError(
            "Couldn't read any text from this Word document. "
            "The file may be empty or contain only images."
        )

    return [DocumentPage(text=combined, page_number=1, source_file=filename)]


def _extract_txt(file_path: str, filename: str) -> List[DocumentPage]:
    """Read text file with encoding detection (utf-8, latin-1 fallback)."""
    text = None

    for encoding in ["utf-8", "latin-1"]:
        try:
            with open(file_path, "r", encoding=encoding) as f:
                text = f.read()
            break
        except (UnicodeDecodeError, UnicodeError):
            continue

    if text is None:
        raise ValueError(
            "Couldn't read this text file. The encoding isn't supported."
        )

    text = text.strip()
    if not text:
        raise ValueError("This text file is empty.")

    return [DocumentPage(text=text, page_number=1, source_file=filename)]


# ============================================================
# Chunking
# ============================================================

def chunk_document(
    pages: List[DocumentPage],
    chunk_size: int = 2500,
    chunk_overlap: int = 300,
) -> List[DocumentChunk]:
    """
    Split document pages into chunks for embedding.

    Strategy (in priority order):
    1. Split on section headers (##, ###) — keeps categories separate
    2. Keep markdown tables intact within their section
    3. If a section exceeds chunk_size, split at paragraph boundaries within it
    4. If a paragraph exceeds chunk_size, split at sentence then word boundaries

    Each chunk carries its section header as prefix for retrieval context.

    Args:
        pages: List of DocumentPage from extract_text().
        chunk_size: Target chunk size in characters (default 2500).
        chunk_overlap: Overlap between consecutive chunks (default 300).

    Returns:
        List of DocumentChunk objects.
    """
    if not pages:
        return []

    chunks = []
    chunk_index = 0

    for page in pages:
        text = page.text.strip()
        if not text:
            continue

        # Check if this page has markdown section headers (from Docling PDF extraction)
        has_headers = bool(re.search(r'^#{1,4}\s+', text, re.MULTILINE))

        if has_headers:
            # Section-aware splitting
            sections = _split_into_sections(text)
            for section in sections:
                section_chunks = _chunk_section(section, chunk_size, chunk_overlap)
                for chunk_text in section_chunks:
                    chunks.append(DocumentChunk(
                        text=chunk_text,
                        page_number=page.page_number,
                        source_file=page.source_file,
                        chunk_index=chunk_index,
                    ))
                    chunk_index += 1
        else:
            # Fallback: paragraph-based splitting (for DOCX, TXT, or PDFs without headers)
            if len(text) <= chunk_size:
                chunks.append(DocumentChunk(
                    text=text,
                    page_number=page.page_number,
                    source_file=page.source_file,
                    chunk_index=chunk_index,
                ))
                chunk_index += 1
            else:
                page_chunks = _split_text_by_paragraphs(text, chunk_size, chunk_overlap)
                for chunk_text in page_chunks:
                    chunks.append(DocumentChunk(
                        text=chunk_text,
                        page_number=page.page_number,
                        source_file=page.source_file,
                        chunk_index=chunk_index,
                    ))
                    chunk_index += 1

    return chunks


def _split_into_sections(text: str) -> List[str]:
    """Split markdown text into sections based on headers.

    Each section includes its header line and all content until the next
    header of equal or higher level. This keeps tables, lists, and
    paragraphs grouped with their section header.

    Returns list of section strings, each starting with its header.
    """
    header_pattern = re.compile(r'^(#{1,4})\s+(.+)$', re.MULTILINE)
    matches = list(header_pattern.finditer(text))

    if not matches:
        return [text]

    sections = []

    # Content before the first header (if any)
    preamble = text[:matches[0].start()].strip()
    if preamble:
        sections.append(preamble)

    # Each header starts a new section, ending at the next header
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section = text[start:end].strip()
        if section:
            sections.append(section)

    return sections


def _chunk_section(section: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """Chunk a single section, preserving its header in each chunk.

    If the section fits in one chunk, return as-is.
    If too large, split at paragraph boundaries (with overlap) but prepend
    the section header to each sub-chunk so retrieval always knows the category.
    Tables are never split across chunks.
    """
    if len(section) <= chunk_size:
        return [section]

    # Extract the header line (first line starting with #)
    lines = section.split('\n', 1)
    header = ""
    body = section

    if lines[0].strip().startswith('#'):
        header = lines[0].strip()
        body = lines[1].strip() if len(lines) > 1 else ""

    if not body:
        return [section]

    # Split body into blocks, keeping tables intact
    blocks = _split_preserving_tables(body)

    # Recombine blocks into chunks that fit within chunk_size
    header_len = len(header) + 2 if header else 0  # +2 for \n\n
    effective_size = chunk_size - header_len

    if effective_size < 200:
        # Header is very long — just use regular splitting
        return _split_text_by_paragraphs(section, chunk_size, chunk_overlap)

    result_chunks = []
    current = ""

    for block in blocks:
        if not block.strip():
            continue

        if current and len(current) + len(block) + 2 > effective_size:
            # Save current chunk with header
            chunk_text = f"{header}\n\n{current.strip()}" if header else current.strip()
            result_chunks.append(chunk_text)
            # Apply overlap: carry end of current chunk into next
            overlap_text = _get_overlap(current, chunk_overlap)
            current = overlap_text + "\n\n" + block if overlap_text else block
        elif len(block) > effective_size:
            # This single block (e.g., huge table) is too large
            if current:
                chunk_text = f"{header}\n\n{current.strip()}" if header else current.strip()
                result_chunks.append(chunk_text)
                current = ""
            # Check if this block is a table — split at row boundaries, not paragraphs
            is_table = any(line.strip().startswith('|') for line in block.split('\n')[:3])
            if is_table:
                sub_chunks = _split_table_by_rows(block, effective_size)
            else:
                sub_chunks = _split_text_by_paragraphs(block, effective_size, chunk_overlap)
            for sc in sub_chunks:
                chunk_text = f"{header}\n\n{sc.strip()}" if header else sc.strip()
                result_chunks.append(chunk_text)
        else:
            if current:
                current += "\n\n" + block
            else:
                current = block

    if current.strip():
        chunk_text = f"{header}\n\n{current.strip()}" if header else current.strip()
        result_chunks.append(chunk_text)

    return result_chunks if result_chunks else [section]


def _split_preserving_tables(text: str) -> List[str]:
    """Split text into blocks, keeping markdown tables as single blocks.

    A markdown table is a contiguous set of lines containing '|'.
    Everything between tables is split at paragraph boundaries.
    """
    lines = text.split('\n')
    blocks = []
    current_block = []
    in_table = False

    for line in lines:
        is_table_line = '|' in line and line.strip().startswith('|')

        if is_table_line:
            if not in_table:
                # Entering a table — save any accumulated non-table text
                if current_block:
                    non_table_text = '\n'.join(current_block).strip()
                    if non_table_text:
                        paragraphs = re.split(r'\n\s*\n', non_table_text)
                        blocks.extend([p.strip() for p in paragraphs if p.strip()])
                    current_block = []
                in_table = True
            current_block.append(line)
        else:
            if in_table:
                # Exiting a table — save the table as one block
                table_text = '\n'.join(current_block).strip()
                if table_text:
                    blocks.append(table_text)
                current_block = []
                in_table = False
            current_block.append(line)

    # Handle remaining content
    if current_block:
        remaining = '\n'.join(current_block).strip()
        if remaining:
            if in_table:
                blocks.append(remaining)
            else:
                paragraphs = re.split(r'\n\s*\n', remaining)
                blocks.extend([p.strip() for p in paragraphs if p.strip()])

    return blocks


def _split_table_by_rows(table_text: str, chunk_size: int) -> List[str]:
    """Split a large markdown table at row boundaries, never mid-row.

    Finds the separator row (|---|---|) and treats everything up to and
    including it as the table header. Each chunk gets a copy of the header
    so column names are always visible.
    """
    lines = table_text.split('\n')
    data_lines = [line for line in lines if line.strip()]

    # Find the table header: column names + separator row (|---|---|)
    # The separator row contains only |, -, :, and spaces.
    header_lines = []
    data_start = 0
    for i, line in enumerate(data_lines):
        if re.match(r'^\|[\s\-:|]+\|$', line.strip()):
            # This is the separator — header is everything up to and including it
            header_lines = data_lines[:i + 1]
            data_start = i + 1
            break

    header_text = '\n'.join(header_lines) if header_lines else ""
    header_len = len(header_text) + 1 if header_text else 0  # +1 for newline
    remaining_rows = data_lines[data_start:]

    chunks = []
    current_rows = []
    current_len = header_len

    for row in remaining_rows:
        if not row.strip():
            continue
        row_len = len(row) + 1  # +1 for newline

        if current_rows and current_len + row_len > chunk_size:
            # Save current chunk with table header prepended
            if header_text:
                chunk = header_text + '\n' + '\n'.join(current_rows)
            else:
                chunk = '\n'.join(current_rows)
            chunks.append(chunk.strip())
            current_rows = [row]
            current_len = header_len + row_len
        else:
            current_rows.append(row)
            current_len += row_len

    if current_rows:
        if header_text:
            chunk = header_text + '\n' + '\n'.join(current_rows)
        else:
            chunk = '\n'.join(current_rows)
        chunks.append(chunk.strip())

    return chunks if chunks else [table_text]


def _split_text_by_paragraphs(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """
    Split text into overlapping chunks at paragraph boundaries.
    Fallback for content without markdown headers (DOCX, TXT, headerless PDFs).

    Strategy:
    1. Split into paragraphs (double newline)
    2. Accumulate paragraphs until chunk_size is reached
    3. If a single paragraph exceeds chunk_size, split at sentence boundaries
    4. If a single sentence exceeds chunk_size, split at word boundaries
    """
    paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    if not paragraphs:
        return [text[:chunk_size]]

    chunks = []
    current_chunk = ""

    for para in paragraphs:
        if current_chunk and len(current_chunk) + len(para) + 2 > chunk_size:
            chunks.append(current_chunk.strip())
            overlap_text = _get_overlap(current_chunk, chunk_overlap)
            current_chunk = overlap_text + "\n\n" + para if overlap_text else para
        elif len(para) > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            sentence_chunks = _split_by_sentences(para, chunk_size, chunk_overlap)
            chunks.extend(sentence_chunks[:-1])
            current_chunk = sentence_chunks[-1] if sentence_chunks else ""
        else:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _split_by_sentences(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """Split text by sentence boundaries when a paragraph is too large."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return _split_by_words(text, chunk_size, chunk_overlap)

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        if current_chunk and len(current_chunk) + len(sentence) + 1 > chunk_size:
            chunks.append(current_chunk.strip())
            overlap_text = _get_overlap(current_chunk, chunk_overlap)
            current_chunk = overlap_text + " " + sentence if overlap_text else sentence
        elif len(sentence) > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            word_chunks = _split_by_words(sentence, chunk_size, chunk_overlap)
            chunks.extend(word_chunks[:-1])
            current_chunk = word_chunks[-1] if word_chunks else ""
        else:
            if current_chunk:
                current_chunk += " " + sentence
            else:
                current_chunk = sentence

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _split_by_words(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """Last resort: split by word boundaries."""
    words = text.split()
    if not words:
        return [text[:chunk_size]]

    chunks = []
    current_chunk = ""

    for word in words:
        if current_chunk and len(current_chunk) + len(word) + 1 > chunk_size:
            chunks.append(current_chunk.strip())
            overlap_text = _get_overlap(current_chunk, chunk_overlap)
            current_chunk = overlap_text + " " + word if overlap_text else word
        else:
            if current_chunk:
                current_chunk += " " + word
            else:
                current_chunk = word

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _get_overlap(text: str, overlap_size: int) -> str:
    """Get the last `overlap_size` characters of text, breaking at a word boundary."""
    if len(text) <= overlap_size:
        return text

    overlap = text[-overlap_size:]
    space_idx = overlap.find(" ")
    if space_idx != -1 and space_idx < len(overlap) // 2:
        overlap = overlap[space_idx + 1:]

    return overlap


# ============================================================
# RAG Instructions (split: system prompt + user message)
# ============================================================

# System-level instruction — appended to the model's system prompt.
# Fine-tuned adapters treat system prompt as their "identity", making these
# rules much harder to override than instructions buried in the user message.
RAG_SYSTEM_INSTRUCTION = (
    "The user has uploaded reference documents. The relevant content from those "
    "documents is provided in their messages between '--- DOCUMENT EXCERPTS ---' "
    "and '--- END OF EXCERPTS ---'. This content is complete for the topic asked "
    "about — do not say you need more information if the answer is in the excerpts.\n\n"
    "Rules for answering with documents:\n"
    "1. Read ALL the provided content before answering. Base your answer on it first.\n"
    "2. ALWAYS cite: end every statement with the source shown at the end of each "
    "section, e.g. [filename, Page X]. Every fact must have a citation.\n"
    "3. Only use information from the section relevant to the question — "
    "do not mix data across different sections or categories.\n"
    "4. Tables: reproduce actual values, do not summarise. A table row with text only "
    "in the first column marks the start of a new category.\n"
    "5. You may supplement with your own knowledge, but clearly distinguish it from "
    "document facts.\n"
    "6. If the documents don't cover the topic, say so clearly."
)

# Lighter preamble for the user message (main rules are in system prompt)
RAG_USER_PREAMBLE = (
    "Here is the relevant content from my uploaded documents. "
    "Answer using this content and cite each fact as [filename, Page X]."
)


# ============================================================
# Embedding Model (shared globally, loaded once)
# ============================================================

# Module-level singleton — the embedding model is ~2.2GB and should only
# be loaded once across all RAGEngine instances.
_embedding_model = None
_embedding_model_name = None


def _get_embedding_model(model_name: str = "all-MiniLM-L6-v2"):
    """
    Get or lazy-load the shared embedding model.
    First call downloads + loads the model (~2-5s).
    Subsequent calls return the cached instance.
    """
    global _embedding_model, _embedding_model_name

    if _embedding_model is not None and _embedding_model_name == model_name:
        return _embedding_model

    logger.info(f"Loading embedding model '{model_name}' (first time may take 30-60 seconds)...")
    from sentence_transformers import SentenceTransformer

    _embedding_model = SentenceTransformer(model_name)
    _embedding_model_name = model_name
    logger.info(f"Embedding model loaded successfully.")
    return _embedding_model


# ============================================================
# RAG Engine
# ============================================================

# Rough estimate: 1 token ≈ 4 characters
_CHARS_PER_TOKEN = 4
_SMALL_DOC_TOKEN_THRESHOLD = 8000
_SMALL_DOC_CHAR_THRESHOLD = _SMALL_DOC_TOKEN_THRESHOLD * _CHARS_PER_TOKEN


class RAGEngine:
    """
    Manages document embedding, FAISS index, and retrieval for one chat session.

    The embedding model is shared globally (loaded once on first use).
    The FAISS index is per-instance (per chat session), in-memory only.

    Usage:
        engine = RAGEngine()
        info = engine.add_document("contract.pdf", "pdf")
        context = engine.build_rag_context("What is the termination clause?")
        # Insert `context` into the prompt before sending to LLM
    """

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self._model_name = model_name

        # Per-session state
        self._chunks: List[DocumentChunk] = []         # All chunks across all docs
        self._embeddings = None                         # numpy array of shape (n_chunks, dim)
        self._faiss_index = None                        # FAISS index
        self._documents: dict[str, DocumentInfo] = {}   # filename -> DocumentInfo
        self._pages: dict[str, List[DocumentPage]] = {} # filename -> original pages (for small-doc path)
        self._total_chars: int = 0                      # Total chars across all docs

    def _ensure_model(self):
        """Ensure the embedding model is loaded (lazy)."""
        return _get_embedding_model(self._model_name)

    @staticmethod
    def get_system_instruction() -> str:
        """Return RAG instruction to append to the model's system prompt.

        Putting rules in the system prompt makes fine-tuned adapters follow
        them more reliably than instructions buried in the user message.
        """
        return RAG_SYSTEM_INSTRUCTION

    def add_document(self, file_path: str, file_type: str) -> DocumentInfo:
        """
        Process a document: extract text → chunk → embed → add to FAISS index.

        Args:
            file_path: Path to the document file.
            file_type: One of 'pdf', 'docx', 'txt'.

        Returns:
            DocumentInfo with summary for UI display.
        """
        import numpy as np

        filename = os.path.basename(file_path)

        # Check for duplicate
        if filename in self._documents:
            raise ValueError(f"'{filename}' is already loaded. Remove it first to re-upload.")

        # Extract text
        pages = extract_text(file_path, file_type)
        total_chars = sum(len(p.text) for p in pages)

        # Chunk the document
        chunks = chunk_document(pages)

        if not chunks:
            raise ValueError(f"No text could be extracted from '{filename}'.")

        # Embed all chunks
        model = self._ensure_model()
        chunk_texts = [c.text for c in chunks]
        new_embeddings = model.encode(chunk_texts, show_progress_bar=False, normalize_embeddings=True)
        new_embeddings = np.array(new_embeddings, dtype=np.float32)

        # Add to FAISS index
        self._add_to_index(new_embeddings)

        # Store chunks and metadata
        self._chunks.extend(chunks)
        self._pages[filename] = pages
        self._total_chars += total_chars

        info = DocumentInfo(
            filename=filename,
            file_type=file_type.lower().strip("."),
            page_count=len(pages),
            chunk_count=len(chunks),
            total_characters=total_chars,
        )
        self._documents[filename] = info

        logger.info(
            f"Added '{filename}': {len(pages)} pages, {len(chunks)} chunks, "
            f"{total_chars} chars. Total docs: {len(self._documents)}"
        )
        return info

    def _add_to_index(self, new_embeddings):
        """Add new embeddings to the FAISS index, creating it if needed."""
        import faiss
        import numpy as np

        if self._faiss_index is None:
            dim = new_embeddings.shape[1]
            # Use inner product (cosine similarity since embeddings are normalized)
            self._faiss_index = faiss.IndexFlatIP(dim)
            self._embeddings = new_embeddings
        else:
            self._embeddings = np.concatenate([self._embeddings, new_embeddings], axis=0)

        self._faiss_index.add(new_embeddings)

    def remove_document(self, filename: str):
        """
        Remove a document's chunks from the engine and rebuild the FAISS index.

        Args:
            filename: The filename of the document to remove.
        """
        import numpy as np

        if filename not in self._documents:
            raise ValueError(f"'{filename}' is not loaded.")

        doc_info = self._documents[filename]

        # Find which chunk indices belong to this document
        keep_indices = []
        for i, chunk in enumerate(self._chunks):
            if chunk.source_file != filename:
                keep_indices.append(i)

        # Rebuild chunks list and embeddings
        self._chunks = [self._chunks[i] for i in keep_indices]
        self._total_chars -= doc_info.total_characters

        # Remove from documents and pages
        del self._documents[filename]
        if filename in self._pages:
            del self._pages[filename]

        # Rebuild FAISS index from remaining embeddings
        self._rebuild_index(keep_indices)

        logger.info(f"Removed '{filename}'. Remaining docs: {len(self._documents)}")

    def _rebuild_index(self, keep_indices: List[int]):
        """Rebuild the FAISS index from a subset of existing embeddings."""
        import faiss
        import numpy as np

        if not keep_indices or self._embeddings is None:
            self._faiss_index = None
            self._embeddings = None
            return

        self._embeddings = self._embeddings[np.array(keep_indices)]
        dim = self._embeddings.shape[1]
        self._faiss_index = faiss.IndexFlatIP(dim)
        self._faiss_index.add(self._embeddings)

    def search(self, query: str, top_k: int = 12) -> List[RetrievedChunk]:
        """
        Hybrid search: FAISS semantic similarity + keyword boosting.

        1. FAISS returns the top candidates ranked by embedding similarity.
        2. Keyword boost: chunks containing exact query words get a score bump,
           so content with matching terminology isn't lost to purely semantic
           ranking.

        Args:
            query: The user's question.
            top_k: Number of top results to return.

        Returns:
            List of RetrievedChunk with text, metadata, and similarity scores.
        """
        if not self._chunks or self._faiss_index is None:
            return []

        import numpy as np

        model = self._ensure_model()
        query_embedding = model.encode([query], show_progress_bar=False, normalize_embeddings=True)
        query_embedding = np.array(query_embedding, dtype=np.float32)

        # Search ALL chunks — small index, so brute-force is fine and ensures
        # keyword/header boosting can rescue chunks that FAISS ranked low.
        candidates_k = len(self._chunks)
        scores, indices = self._faiss_index.search(query_embedding, candidates_k)

        # Extract meaningful query keywords (>= 3 chars, lowercased)
        query_lower = query.lower()
        query_words = [w for w in re.findall(r'\w+', query_lower) if len(w) >= 3]

        # Build multi-word phrases from query for section header matching
        # e.g., "dark magic" from "list all dark magic spells"
        query_phrases = []
        if len(query_words) >= 2:
            for i in range(len(query_words) - 1):
                query_phrases.append(f"{query_words[i]} {query_words[i + 1]}")

        # Also detect page references like "page 84"
        page_refs = re.findall(r'page\s*(\d+)', query_lower)

        candidates = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self._chunks):
                continue
            chunk = self._chunks[idx]
            chunk_lower = chunk.text.lower()

            # Keyword boost: fraction of query words found in chunk
            if query_words:
                keyword_hits = sum(1 for w in query_words if w in chunk_lower)
                keyword_ratio = keyword_hits / len(query_words)
            else:
                keyword_ratio = 0.0

            # Section header boost: if query matches the chunk's ## header,
            # this is almost certainly the right chunk. Much stronger than keyword.
            # Normalize whitespace (Docling sometimes outputs "Dark  Magic" with
            # double spaces) before comparing.
            header_boost = 0.0
            first_line = chunk.text.split('\n')[0].strip().lower()
            if first_line.startswith('#'):
                header_text = ' '.join(re.sub(r'[^\w\s]', '', re.sub(r'^#+\s*', '', first_line)).split())
                # Multi-word phrase match (e.g., "dark magic" → "## Dark Magic")
                for phrase in query_phrases:
                    if phrase in header_text:
                        header_boost = 0.5
                        break
                # Single keyword matches full header (e.g., "necromancy" → "## Necromancy")
                if header_boost == 0.0:
                    for w in query_words:
                        if w == header_text or header_text.startswith(w + ' ') or header_text.endswith(' ' + w):
                            header_boost = 0.4
                            break

            # Page reference boost: if user asks about a specific page
            page_boost = 0.0
            if page_refs:
                for page_num_str in page_refs:
                    if chunk.page_number == int(page_num_str):
                        page_boost = 0.15

            # Combined score: semantic + keyword + header + page
            boosted_score = float(score) + (keyword_ratio * 0.15) + header_boost + page_boost

            candidates.append(RetrievedChunk(
                text=chunk.text,
                page_number=chunk.page_number,
                source_file=chunk.source_file,
                similarity_score=boosted_score,
            ))

        # Re-rank by boosted score and return top_k
        candidates.sort(key=lambda c: c.similarity_score, reverse=True)
        top_results = candidates[:top_k]

        # Sibling chunk expansion: if a chunk's section header (## ...) is in the
        # results, include ALL chunks with the same header. This ensures multi-chunk
        # sections (e.g., "## Dark Magic" split into 2 chunks) are fully returned.
        top_results = self._expand_sibling_chunks(top_results, candidates)

        return top_results

    _MAX_SIBLING_EXPANSION = 6  # Cap to prevent context explosion

    def _expand_sibling_chunks(
        self,
        top_results: List[RetrievedChunk],
        all_candidates: List[RetrievedChunk],
    ) -> List[RetrievedChunk]:
        """Include sibling chunks sharing a section header with any top result.

        If "## Dark Magic" chunk 1 is in results but chunk 2 isn't, this adds
        chunk 2 so the model sees the complete section. Siblings inherit a score
        just below their section mate so they sort adjacent (not at the end
        where budget truncation would discard them first).

        Capped at _MAX_SIBLING_EXPANSION to avoid blowing the context budget.
        """
        # Map section headers to the best score from top results
        header_scores: dict[tuple[str, str], float] = {}  # (header, source_file) -> best score
        for r in top_results:
            first_line = r.text.split('\n')[0].strip()
            if first_line.startswith('#'):
                key = (first_line, r.source_file)
                if key not in header_scores or r.similarity_score > header_scores[key]:
                    header_scores[key] = r.similarity_score

        if not header_scores:
            return top_results

        # Find sibling chunks not already in results
        existing_texts = {r.text for r in top_results}
        siblings = []

        for chunk in self._chunks:
            if chunk.text in existing_texts:
                continue
            first_line = chunk.text.split('\n')[0].strip()
            key = (first_line, chunk.source_file)
            if key in header_scores:
                # Score just below section mate so siblings sort adjacent
                siblings.append(RetrievedChunk(
                    text=chunk.text,
                    page_number=chunk.page_number,
                    source_file=chunk.source_file,
                    similarity_score=header_scores[key] - 0.01,
                ))
                if len(siblings) >= self._MAX_SIBLING_EXPANSION:
                    break

        if siblings:
            combined = top_results + siblings
            combined.sort(key=lambda c: c.similarity_score, reverse=True)
            return combined

        return top_results

    @staticmethod
    def _filter_by_relevance_gap(
        results: List[RetrievedChunk],
        gap_threshold: float = 0.3,
        min_results: int = 2,
    ) -> List[RetrievedChunk]:
        """Drop low-relevance filler chunks when there's a clear score gap.

        If the top results score 0.9+ and then scores drop to 0.3, the low
        scorers are unrelated filler that would confuse the model. Cut them.

        Always keeps at least min_results chunks. After that, cuts at the
        first gap exceeding gap_threshold.
        """
        if len(results) <= min_results:
            return results

        for i in range(min_results, len(results)):
            prev_score = results[i - 1].similarity_score
            curr_score = results[i].similarity_score
            if prev_score - curr_score >= gap_threshold:
                return results[:i]

        return results

    def build_rag_context(self, query: str, top_k: int = 12, char_budget: int = 12_000) -> str:
        """
        Build the RAG context string for the user message.

        Budget-aware: stops adding chunks at chunk boundaries when the budget
        is exceeded, so content is never cut mid-chunk or mid-table.

        Hybrid strategy:
        - Small total docs that fit in budget: return ALL document text
        - Otherwise: FAISS search → format top-k chunks until budget fills

        The main RAG rules live in get_system_instruction() (for the system
        prompt). This method returns a lighter preamble + document excerpts.

        Args:
            query: The user's question.
            top_k: Number of chunks to retrieve (search path only).
            char_budget: Maximum character budget for the entire context string.

        Returns:
            Ready-to-inject string with preamble + document excerpts.
        """
        if not self._documents:
            return ""

        header = "--- DOCUMENT EXCERPTS ---"
        footer = "--- END OF EXCERPTS ---"

        # Calculate space available for actual excerpts
        overhead = len(RAG_USER_PREAMBLE) + len(header) + len(footer) + 8  # newlines
        available = char_budget - overhead

        if available < 500:
            return ""  # Budget too small to be useful

        # Small-doc path: include all text if it fits in budget
        if self._total_chars < _SMALL_DOC_CHAR_THRESHOLD:
            all_text = "\n".join(self._format_all_pages())
            if len(all_text) <= available:
                return f"{RAG_USER_PREAMBLE}\n\n{header}\n\n{all_text}\n\n{footer}"
            # Doesn't fit — fall through to search path

        # Search path: retrieve + format chunks until budget is filled
        retrieved = self.search(query, top_k=top_k)
        if not retrieved:
            return ""

        # Relevance gap filter: if there's a big score drop between top results
        # and filler, stop early. This prevents unrelated sections (e.g., "Charge
        # Reactions" when user asked about "melee weapons") from being included
        # and confusing the model into cross-contaminating its answer.
        retrieved = self._filter_by_relevance_gap(retrieved)

        excerpts = []
        used = 0
        for chunk in retrieved:
            entry = self._format_source_block(chunk.text, chunk.source_file, chunk.page_number)
            entry_len = len(entry) + 2  # +2 for separator newlines
            if used + entry_len > available and excerpts:
                break  # Stop at chunk boundary — never cut mid-chunk
            excerpts.append(entry)
            used += entry_len

        if not excerpts:
            return ""

        excerpts_text = "\n\n".join(excerpts)
        return f"{RAG_USER_PREAMBLE}\n\n{header}\n\n{excerpts_text}\n\n{footer}"

    @staticmethod
    def _format_source_block(text: str, filename: str, page_number: int) -> str:
        """Format a single excerpt with source label and inline citation hint.

        The citation tag at the end of each block makes fine-tuned models more
        likely to cite, because it's part of the content they read — not an
        instruction they might ignore.
        """
        sanitized = _sanitize_rag_text(text)
        cite_tag = f"[{filename}, Page {page_number}]"
        return f"[Source: {filename} | Page {page_number}]\n{sanitized}\n(Source: {cite_tag})"

    def _format_all_pages(self) -> List[str]:
        """Format all loaded pages with source labels (small-doc path)."""
        formatted = []
        for filename, pages in self._pages.items():
            for page in pages:
                formatted.append(self._format_source_block(page.text, filename, page.page_number))
                formatted.append("")
        return formatted

    def _format_retrieved_chunks(self, chunks: List[RetrievedChunk]) -> List[str]:
        """Format retrieved chunks with source labels (large-doc path)."""
        formatted = []
        for chunk in chunks:
            formatted.append(self._format_source_block(chunk.text, chunk.source_file, chunk.page_number))
            formatted.append("")
        return formatted

    def get_loaded_documents(self) -> List[DocumentInfo]:
        """Return list of currently loaded documents (for UI display)."""
        return list(self._documents.values())

    def has_documents(self) -> bool:
        """Check if any documents are loaded."""
        return len(self._documents) > 0

    def clear(self):
        """Reset all documents, chunks, and the FAISS index (session cleanup)."""
        self._chunks.clear()
        self._embeddings = None
        self._faiss_index = None
        self._documents.clear()
        self._pages.clear()
        self._total_chars = 0
        logger.info("RAGEngine cleared — all documents removed.")
