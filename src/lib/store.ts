"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
type Store = {
  theme: "light" | "dark";
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setSidebar: (open: boolean) => void;
};
export const useUI = create<Store>()(
  persist(
    (set) => ({
      theme: "light",
      sidebarOpen: false,
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setSidebar: (sidebarOpen) => set({ sidebarOpen }),
    }),
    { name: "harness-preferences", partialize: (s) => ({ theme: s.theme }) },
  ),
);
