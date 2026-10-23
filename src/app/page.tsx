import Link from "next/link";
import { BarChart3, ClipboardList, ShieldCheck, Sparkles } from "lucide-react";
import { Container } from "@/components/layout/container";
import { EmergencyNotice } from "@/components/safety/safety-notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { safetyCopy, siteConfig } from "@/lib/site";

const features = [
  {
    icon: ClipboardList,
    title: "Guided reporting",
    description:
      "Step-by-step questions in plain language, for patients, caregivers and healthcare professionals.",
  },
  {
    icon: Sparkles,
    title: "AI-assisted, you confirm",
    description:
      "Describe what happened in your own words. AI suggests medicines, symptoms and dates — you check and confirm every item.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy by design",
    description:
      "Only the minimum personal details are collected, and reports are visible only to authorised reviewers.",
  },
  {
    icon: BarChart3,
    title: "Aggregate analytics",
    description:
      "A public trend dashboard of aggregate counts. This demonstration uses clearly labelled synthetic data only.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border bg-surface">
        <Container className="flex flex-col gap-8 py-14 sm:py-20">
          <Badge tone="primary" className="self-start">
            HEALTHX 2026 prototype
          </Badge>
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              {siteConfig.tagline}
            </h1>
            <p className="text-lg text-pretty text-muted">
              {siteConfig.name} helps you record a suspected adverse drug
              reaction in a structured way, so it can be reviewed by healthcare
              professionals.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/report" className={buttonVariants({ size: "lg" })}>
              Report a suspected reaction
            </Link>
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              View analytics demo
            </Link>
          </div>
          <p className="max-w-3xl text-sm text-muted">
            {safetyCopy.doNotStopMedication}
          </p>
        </Container>
      </section>

      <Container className="flex flex-col gap-10 py-12">
        <EmergencyNotice />
        <section
          aria-labelledby="features-heading"
          className="flex flex-col gap-6"
        >
          <h2 id="features-heading" className="text-xl font-semibold">
            How it works
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title}>
                <CardHeader>
                  <span className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </Container>
    </>
  );
}
