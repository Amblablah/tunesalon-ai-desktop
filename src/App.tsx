import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { SidecarProvider, useSidecar } from './contexts/SidecarContext';
import { router } from './routes';
import WelcomeScreen, { shouldShowWelcome } from './components/system/WelcomeScreen';
import LoadingScreen from './components/LoadingScreen';
import SidecarBanner from './components/SidecarBanner';
import SetupScreen from './components/setup/SetupScreen';

const SETUP_DONE_KEY = 'tunesalon_setup_done';

function AppContent() {
  const [showWelcome, setShowWelcome] = useState(shouldShowWelcome);
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem(SETUP_DONE_KEY) === 'true');
  const [hasBeenReady, setHasBeenReady] = useState(false);
  const { status } = useSidecar();

  // Track if sidecar was ever ready (to distinguish startup vs mid-session failure)
  if (status === 'ready' && !hasBeenReady) {
    setHasBeenReady(true);
  }

  // Startup: show loading/error screen until sidecar is ready for the first time
  if (!hasBeenReady) {
    return <LoadingScreen />;
  }

  // Setup gate: check dependencies on first launch
  if (!setupDone) {
    return (
      <SetupScreen
        onComplete={() => {
          localStorage.setItem(SETUP_DONE_KEY, 'true');
          setSetupDone(true);
        }}
      />
    );
  }

  // Post-startup: show the app with a banner if sidecar crashes mid-session
  return (
    <>
      <SidecarBanner />
      {showWelcome ? (
        <WelcomeScreen onDismiss={() => setShowWelcome(false)} />
      ) : (
        <RouterProvider router={router} />
      )}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SidecarProvider>
        <AppContent />
      </SidecarProvider>
    </ThemeProvider>
  );
}
