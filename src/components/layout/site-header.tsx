import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { mainNav, siteConfig } from "@/lib/site";
import { Container } from "./container";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-foreground"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <HeartPulse className="size-5" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline">{siteConfig.name}</span>
          <span className="sr-only sm:hidden">{siteConfig.name}</span>
        </Link>
        <nav aria-label="Main" className="-mr-2 overflow-x-auto">
          <ul className="flex items-center gap-1 text-sm">
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 whitespace-nowrap text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
