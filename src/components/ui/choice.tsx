import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
};

export function Checkbox({
  id,
  label,
  description,
  className,
  ...props
}: CheckboxProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={descriptionId}
        className="mt-0.5 size-5 shrink-0 rounded border-border-strong accent-primary"
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type RadioCardGroupProps<T extends string> = {
  name: string;
  legend: React.ReactNode;
  options: readonly {
    value: T;
    label: React.ReactNode;
    description?: React.ReactNode;
  }[];
  value: string;
  onChange: (value: T) => void;
  error?: string;
  required?: boolean;
  className?: string;
};

/** Accessible radio group rendered as selectable cards. */
export function RadioCardGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  required,
  className,
}: RadioCardGroupProps<T>) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset
      className={cn("flex flex-col gap-2", className)}
      aria-describedby={errorId}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium text-foreground">
        {legend}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                checked
                  ? "border-primary bg-primary-soft"
                  : error
                    ? "border-danger"
                    : "border-border-strong hover:bg-surface-muted",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-muted">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
