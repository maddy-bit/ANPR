"use client";

import { motion } from "framer-motion";

interface SystemBootLoaderProps {
  onComplete: () => void;
  isOpen: boolean;
  targetVehicleType?: string;
  targetColor?: string;
}

/** Neutral loading state. Readiness is reported by the owning workflow, not simulated here. */
export function SystemBootLoader({ isOpen }: SystemBootLoaderProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-6 text-white"
      role="status"
      aria-live="polite"
      aria-label="Preparing the application"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-w-sm flex-col items-center gap-5 text-center"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
        <div>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em]">
            Preparing investigation workspace
          </p>
          <p className="mt-2 text-sm text-slate-300">
            Camera and model availability will be shown from connected service status.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

