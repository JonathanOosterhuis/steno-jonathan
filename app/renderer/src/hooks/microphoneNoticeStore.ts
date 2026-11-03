import { create } from 'zustand';
import type { MicrophoneNotice } from '@/lib/microphoneRecovery';
export const useMicrophoneNotice = create<{
  notice: MicrophoneNotice;
  set: (notice: MicrophoneNotice) => void;
}>((set) => ({
  notice: null,
  set: (notice) => set({ notice }),
}));
