import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import GpuBadge from './GpuBadge';
import Spinner from '../shared/Spinner';

const tabs = [
  { to: '/system', label: 'System' },
  { to: '/train', label: 'Train' },
  { to: '/chat', label: 'Chat' },
  { to: '/library', label: 'Library' },
  { to: '/settings', label: 'Settings' },
];

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻';
  return (
    <button
      onClick={cycleTheme}
      className="text-sm px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"
      title={`Theme: ${theme}`}
    >
      {icon}
    </button>
  );
}

export default function AppLayout() {
  return (
    <div className="h-screen flex flex-col">
      {/* Top nav bar */}
      <nav className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900">
        {/* Left: logo + tabs */}
        <span className="font-mono font-bold text-sm mr-4 text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
          TuneSalon Desktop
        </span>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}

        {/* Right: GPU badge + theme toggle */}
        <div className="ml-auto flex items-center gap-2">
          <GpuBadge />
          <ThemeToggle />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
