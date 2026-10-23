import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex gap-3 rounded-lg border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        info: "border-info/25 bg-info-soft text-foreground [&>svg]:text-info",
        success:
          "border-success/25 bg-success-soft text-foreground [&>svg]:text-success",
        warning:
          "border-warning/30 bg-warning-soft text-foreground [&>svg]:text-warning",
        danger:
          "border-danger/25 bg-danger-soft text-foreground [&>svg]:text-danger",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
} as const;

export type AlertProps = Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & { title?: React.ReactNode };

export function Alert({
  className,
  tone,
  title,
  children,
  ...props
}: AlertProps) {
  const Icon = icons[tone ?? "info"];
  // Danger alerts interrupt screen readers; others are announced politely.
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div
      role={role}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-foreground/90">{children}</div>
      </div>
    </div>
  );
}
