import { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import type { SystemInfo } from '../../types/system';

interface TrainStatus {
  status: string;
}

export default function GpuBadge() {
  const [gpuName, setGpuName] = useState<string | null>(null);
  const [vram, setVram] = useState<number | null>(null);
  const [hasGpu, setHasGpu] = useState(false);
  const [training, setTraining] = useState(false);
  const [backendUp, setBackendUp] = useState(false);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const sys = await apiFetch<SystemInfo>('/system/info');
        if (!active) return;
        setGpuName(sys.gpu?.name || null);
        setVram(sys.gpu?.vram_gb || null);
        setHasGpu(sys.has_gpu);
        setBackendUp(true);
      } catch {
        if (!active) return;
        setBackendUp(false);
        return;
      }

      try {
        const train = await apiFetch<TrainStatus>('/train/result');
        if (!active) return;
        setTraining(['downloading', 'preparing', 'training', 'saving'].includes(train.status));
      } catch {
        if (!active) return;
        setTraining(false);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (!backendUp) {
    return (
      <span className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-800 text-gray-500">
        Backend offline
      </span>
    );
  }

  const label = hasGpu
    ? `${gpuName || 'GPU'}${vram ? ` (${vram}GB)` : ''}`
    : 'CPU Mode';

  let activity = '';
  if (training) activity = ' · Training...';

  const badgeColor = training
    ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
    : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';

  return (
    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${badgeColor}`}>
      {label}{activity}
    </span>
  );
}
