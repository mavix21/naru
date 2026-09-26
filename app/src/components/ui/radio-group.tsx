import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const radioGroupItemVariants = cva(
  "group/radio-group-item peer relative flex aspect-square shrink-0 rounded-full outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "size-4 border border-transparent bg-input/90 focus-visible:border-ring data-checked:bg-primary data-checked:text-primary-foreground aria-invalid:border-destructive dark:data-checked:bg-primary dark:aria-invalid:border-destructive/50",
        // The option itself is the color. Selection is an outline so the
        // chosen accent stays visible instead of being covered by primary.
        swatch:
          "size-11 border-4 border-background bg-transparent focus-visible:border-background data-checked:ring-2 data-checked:ring-primary data-checked:ring-offset-2 data-checked:ring-offset-background aria-invalid:border-destructive dark:aria-invalid:border-destructive/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  variant = "default",
  ...props
}: RadioPrimitive.Root.Props & VariantProps<typeof radioGroupItemVariants>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(radioGroupItemVariants({ variant, className }))}
      {...props}
    >
      {variant !== "swatch" && (
        <RadioPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="flex size-4 items-center justify-center"
        >
          <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground dark:size-2.5" />
        </RadioPrimitive.Indicator>
      )}
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem, radioGroupItemVariants };
