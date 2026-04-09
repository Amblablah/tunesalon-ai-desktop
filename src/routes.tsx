import { createHashRouter, Navigate } from 'react-router-dom';
import { lazy } from 'react';
import AppLayout from './components/layout/AppLayout';

const SystemPage = lazy(() => import('./components/system/SystemPage'));
const TrainPage = lazy(() => import('./components/train/TrainPage'));
const ChatPage = lazy(() => import('./components/chat/ChatPage'));
const LibraryPage = lazy(() => import('./components/library/LibraryPage'));
const SettingsPage = lazy(() => import('./components/settings/SettingsPage'));

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/system" replace /> },
      { path: 'system', element: <SystemPage /> },
      { path: 'train', element: <TrainPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
