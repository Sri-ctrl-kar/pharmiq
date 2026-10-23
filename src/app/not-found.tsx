import Link from "next/link";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Container className="flex flex-col items-start gap-4 py-20">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you are looking for does not exist.</p>
      <Link href="/" className={buttonVariants()}>
        Go to home
      </Link>
    </Container>
  );
}
