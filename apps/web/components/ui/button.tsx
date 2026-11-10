import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

// min-h-11 (44px) keeps every control above the 2.5.8 target-size minimum.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-fg hover:opacity-90',
        outline: 'border-2 border-border bg-bg text-fg hover:bg-surface',
        ghost: 'text-fg hover:bg-surface',
        danger: 'bg-danger text-danger-bg hover:opacity-90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />;
});
Button.displayName = 'Button';
export { buttonVariants };
