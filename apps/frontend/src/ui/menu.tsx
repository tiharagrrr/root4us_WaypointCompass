import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/**
 * A dropdown menu in the Compass surface styles. The Figma file has no menu component, so this
 * follows the Select popover: border, radius/md, shadow-md, and the same hover tone on its items
 * (docs/departures.md).
 */
export const Menu = MenuPrimitive.Root
export const MenuTrigger = MenuPrimitive.Trigger

export function MenuContent({ className, align = 'start', sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="menu-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[220px] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

export function MenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        'type-body relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-foreground outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label data-slot="menu-label" className={cn('type-label px-2 py-1.5 uppercase text-muted-foreground', className)} {...props} />
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator data-slot="menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}
