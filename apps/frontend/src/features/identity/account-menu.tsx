import { useDemoUsers, useMeGet, type DemoUserDto } from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { initials, roleLabel } from '@/lib/roles'
import { Icon } from '@/ui/icon'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/ui/menu'
import { Skeleton } from '@/ui/skeleton'
import { toast } from '@/ui/toast-store'
import { authClient } from './auth-client'
import { ROLE_HOME } from './role-home'
import { useSignOut } from './sign-out'
import { scopeLabel } from './scope-label'

/**
 * The signed-in person at the foot of a desktop sidebar, and what they can do about it: sign out,
 * and — in demo mode only — become one of the other seeded users, which is how a demo walks one
 * order from the store counter to the driver's phone without typing a password on stage.
 *
 * GET /demo/users is the demo flag: outside demo mode it answers 404 and the switch list is not
 * offered. The frames draw the account card without a menu (docs/departures.md).
 */
export function AccountMenu() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useMeGet()
  const endSession = useSignOut()
  const cast = useDemoUsers()
  const [busy, setBusy] = useState(false)

  if (me.isPending) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border px-2 pt-[13px]">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    )
  }
  if (!me.data) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border px-2 pt-[13px]">
        <span className="type-caption text-muted-foreground">Not signed in</span>
      </div>
    )
  }

  const person = me.data.data
  const others = (cast.data?.data.users ?? []).filter((user) => user.id !== person.id)

  /** A switch and a sign-out both change who the app is for, so the cache starts again empty. */
  const start = async (to: string) => {
    queryClient.clear()
    await navigate(to, { replace: true })
  }

  const signOut = async () => {
    setBusy(true)
    try {
      await endSession()
    } finally {
      setBusy(false)
    }
  }

  const switchTo = async (user: DemoUserDto) => {
    setBusy(true)
    try {
      const { error } = await authClient.$fetch('/sign-in/demo', { method: 'POST', body: { userId: user.id } })
      if (error) {
        toast({ title: `Could not switch to ${user.name}`, description: error.message, tone: 'danger' })
        return
      }
      await start(ROLE_HOME[user.role])
      toast({ title: `Signed in as ${user.name}`, description: roleLabel(user.role) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-border pt-[13px]">
      <Menu>
        <MenuTrigger
          disabled={busy}
          aria-label={`${person.name}, ${roleLabel(person.role)}. Switch user or sign out`}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-sans text-[12px] font-bold text-primary">
            {initials(person.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px leading-auto">
            <span className="truncate font-sans text-[13px] font-bold text-foreground">{person.name}</span>
            <span className="type-caption truncate text-muted-foreground">{roleLabel(person.role)}</span>
          </span>
          <Icon name="chevron-down-small" className="text-slate-500" />
        </MenuTrigger>
        <MenuContent side="top" className="w-[216px]">
          {others.length > 0 ? (
            <>
              <MenuLabel>Switch user · demo</MenuLabel>
              {others.map((user) => (
                <MenuItem key={user.id} onSelect={() => void switchTo(user)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">{user.name}</span>
                    <span className="type-mono-small truncate text-muted-foreground">
                      {roleLabel(user.role)} · {scopeLabel(user)}
                    </span>
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem onSelect={() => void signOut()}>Sign out</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
