# Fawxzzy Auth Surface Family

Status: source contract for the shared Website, Fitness, and Mazer authentication family.

## Decision

The three products use one rigid authentication anatomy. Product theme may change; screen structure may not.

- Fitness is the canonical structural reference: centered fields, no subtitle, a compact secondary-action row, one strong bottom-dock action, safe-area-aware spacing, and minimal visual noise.
- FawxzzyWeb and Mazer reuse that structure rather than approximating it with product-specific positioning.
- Each product owns only its background, accent palette, product wordmark, and destination-specific wording.
- Capability truth wins over visual consistency. A product must never show an enabled action when its account adapter or service registration is unavailable.

## Required anatomy

Every sign-in and create-account surface provides these elements in this order:

1. Product identity.
2. `Welcome` or `Create account`, with the remembered username directly below `Welcome` when available.
3. Labeled identifier and password controls with password-manager semantics and the shared password-visibility icon.
4. A compact sign-in/create-account/recovery action row.
5. One full-width bottom-dock submit action with visible disabled and pending states.

The forced first-run auth surface does not include a home/back action, subtitle, guest-play action, or separate display-name field. Username is the public display name.

The family requires 44px minimum interactive targets, visible keyboard focus, no horizontal overflow at 320px, reduced-motion support, and safe-area-aware vertical spacing.

## Product variants

### FawxzzyWeb

- Product marker: `Fawxzzy`.
- Background: Fawxzzy wolf-brand charcoal, sage, and soft neutral light fields.
- Desktop and mobile: the same bounded one-column Fitness-shaped frame.
- The remembered username is stored as optional local presentation state after a successful session and never becomes authentication authority.
- Current service boundary: account actions remain visibly unavailable unless the approved adapter resolves at runtime.

### Fitness

- Preserve the existing Fitness auth shell, field treatment, bottom action rhythm, and green fitness background.
- Copy may name Fitness-specific account outcomes.
- Do not restyle the active login route while another exact writer owns it. Reconcile that work first, then change only proven contract gaps.

### Mazer

- Implement the same anatomy inside the Phaser runtime rather than importing Website or Fitness components.
- Background: Mazer's own static auth background; gameplay, simulation, announcements, and ambient motion are halted while auth is visible.
- Preserve one overlay and recoverable input behavior without guest-play access.
- Do not change the auth/menu surface while another exact writer owns it. Reconcile that work first, then implement from a fresh exact parent.

## Mazer pattern intake

| Pattern | Decision | Application |
| --- | --- | --- |
| Safe-area and dynamic viewport ownership | ADAPT | Keep the auth task and primary action clear of browser and device insets. |
| Persistent bottom controls | ADAPT | Use the Fitness rhythm for the primary auth action without copying React layout code. |
| Safe-default responsive layouts | ADOPT | Keep labels, fields, and actions usable across the supported viewport matrix. |
| Install capability | NOT_APPLICABLE | Auth layout work does not change install behavior. |
| Served-build provenance | ADOPT | Verify the final Mazer implementation against its served exact build. |
| One overlay and recoverable interaction | ADOPT | Keep one bounded auth overlay and preserve escape/recovery behavior. |
| Accessible motion preferences | ADAPT | Reduce or stop background motion without removing product identity. |
| Versioned persistent state | ADOPT | Preserve current state contracts; this family introduces no schema change. |

## Sequencing and ownership

1. Fitness remains the locked structural reference.
2. FawxzzyWeb and Mazer implement their own rendering primitives against this exact anatomy.
3. Each product requires focused tests, responsive screenshots, exact-head review, and a separately authorized release.

Failure mode: visual mimicry without a shared structural contract drifts into absolute positioning, extra copy, inconsistent actions, and moving controls. Tests must assert the anatomy and layout behavior, not only the presence of labels.

This contract grants no commit, push, pull-request, merge, provider, deployment, or production authority.
