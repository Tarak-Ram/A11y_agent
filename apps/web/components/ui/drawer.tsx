'use client';
import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';

/** Right-hand drawer built on Radix Dialog: focus trap, Esc to close, focus returns to the trigger, labelled title. */
export function Drawer({ open, onOpenChange, title, description, children, returnFocusTo }: { returnFocusTo?: React.RefObject<HTMLElement | null>; open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-bg p-6 shadow-xl focus:outline-none" onCloseAutoFocus={(e) => {
            // Controlled dialog has no Trigger, so return focus to the control that opened it (2.4.3).
            if (returnFocusTo?.current) {
              e.preventDefault();
              returnFocusTo.current.focus();
            }
          }}>
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-2xl font-bold">{title}</Dialog.Title>
            <Dialog.Close className="min-h-11 min-w-11 rounded-md border-2 border-border px-3 font-semibold hover:bg-surface">
              Close<span className="sr-only"> finding details</span>
            </Dialog.Close>
          </div>
          {description ? <Dialog.Description className="mt-1 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Finding details</Dialog.Description>}
          <div className="mt-6 space-y-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
