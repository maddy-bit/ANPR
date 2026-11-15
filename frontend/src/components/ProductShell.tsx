"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const navigation = [
  { href: "/agent", label: "Investigation agent", icon: "AI" },
  { href: "/", label: "Command center", icon: "◫" },
  { href: "/investigations", label: "Investigations", icon: "⌕" },
  { href: "/cases", label: "Case files", icon: "▤" },
  { href: "/camera-network", label: "Camera network", icon: "⌖" },
  { href: "/data-sources", label: "Data sources", icon: "⇄" },
  { href: "/evidence", label: "Evidence", icon: "▣" },
  { href: "/analytics", label: "Analytics", icon: "▥" },
  { href: "/administration", label: "Administration", icon: "⚙" },
];

export function ProductShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[72px] items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">CT</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-slate-950">City AI Traffic</p>
            <p className="text-[11px] text-slate-500">Vehicle intelligence platform</p>
          </div>
        </div>
        <div className="px-4 pt-6 pb-2">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">Workspace</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={"flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors " +
                  (active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950")}
              >
                <span className="w-5 text-center text-base" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">City AI Traffic</p>
            <p className="mt-1 text-[11px] text-slate-500">SIH26127 · India deployment</p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex min-h-[64px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="min-w-0 lg:hidden">
            <p className="text-sm font-semibold text-slate-950">City AI Traffic</p>
            <p className="text-[10px] text-slate-500">Vehicle intelligence platform</p>
          </div>
          <div className="hidden text-sm font-medium text-slate-700 lg:block">
            {navigation.find((item) => item.href === pathname)?.label || navigation.find((item) => pathname.startsWith(item.href + "/"))?.label || "Workspace"}
          </div>
          <nav className="flex max-w-[calc(100vw-130px)] items-center gap-1 overflow-x-auto lg:hidden">
            {navigation.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={"whitespace-nowrap rounded px-2.5 py-2 text-xs " + (active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Service status is available in Administration
          </div>
        </header>
        <main className="min-h-[calc(100vh-64px)]">{children}</main>
      </div>
    </div>
  );
}
