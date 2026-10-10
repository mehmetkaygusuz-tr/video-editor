export type AppMode = 'basic' | 'pro' | null;

export type MobilePanel = 'none' | 'library' | 'inspector' | 'ai-tasks';

class AppState {
  onboardingComplete = $state(true);
  mode = $state<AppMode>('pro');

  // UI State Panels
  isLibraryOpen = $state(true);
  isInspectorOpen = $state(false);
  activeMobilePanel = $state<MobilePanel>('none');
  activeAITask = $state<{ name: string; progress: number } | null>(null);

  constructor() {
    this.loadState();
  }

  loadState() {
    try {
      const state = localStorage.getItem('toolx_state');
      if (state) {
        const parsed = JSON.parse(state);
        this.onboardingComplete = true; // Always bypass onboarding wizard
        this.mode = 'pro';
      }
    } catch (e) {
      console.warn("Could not load state from LocalStorage", e);
    }
  }

  saveState() {
    try {
      localStorage.setItem('toolx_state', JSON.stringify({
        onboardingComplete: true,
        mode: 'pro'
      }));
    } catch (e) {
      console.warn("Could not save state to LocalStorage", e);
    }
  }

  completeOnboarding(mode: AppMode = 'pro') {
    this.mode = 'pro';
    this.onboardingComplete = true;
    this.saveState();
  }

  reset() {
    this.onboardingComplete = true;
    this.mode = 'pro';
    this.saveState();
  }

  // UI Actions
  toggleLibrary() {
    this.isLibraryOpen = !this.isLibraryOpen;
  }

  toggleInspector() {
    this.isInspectorOpen = !this.isInspectorOpen;
  }

  openMobilePanel(panel: MobilePanel) {
    this.activeMobilePanel = panel;
  }

  closeMobilePanel() {
    this.activeMobilePanel = 'none';
  }

  startAITask(name: string) {
    this.activeAITask = { name, progress: 0 };
  }

  updateAITask(progress: number) {
    if (this.activeAITask) {
      this.activeAITask.progress = progress;
      if (progress >= 100) {
        setTimeout(() => { this.activeAITask = null; }, 1500);
      }
    }
  }
}

export const appState = new AppState();
