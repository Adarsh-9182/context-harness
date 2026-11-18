"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
type Store = {
  theme: "light" | "dark";
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  toggleTheme: () => void;
  setSidebar: (open: boolean) => void;
  setSidebarPinned: (open: boolean) => void;
};
export const useUI = create<Store>()(
  persist(
    (set) => ({
      theme: "light",
      sidebarOpen: false,
      sidebarPinned: true,
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setSidebar: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
    }),
    { name: "harness-preferences", partialize: (s) => ({ theme: s.theme, sidebarPinned: s.sidebarPinned }) },
  ),
);
