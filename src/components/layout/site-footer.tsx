import Link from "next/link";
import { safetyCopy, siteConfig } from "@/lib/site";
import { Container } from "./container";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <Container className="flex flex-col gap-4 py-8 text-sm text-muted">
        <p className="max-w-3xl">{safetyCopy.notMedicalAdvice}</p>
        <p className="max-w-3xl">{safetyCopy.notOfficial}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs">
          <span>{siteConfig.name} · HEALTHX 2026 prototype</span>
          <Link href="/design-system" className="hover:text-foreground">
            Design system
          </Link>
        </div>
      </Container>
    </footer>
  );
}
