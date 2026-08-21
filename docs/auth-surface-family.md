# Fawxzzy Auth Surface Family

Status: source contract for the shared Website, Fitness, and Mazer authentication family.

## Decision

The three products use one recognizable authentication anatomy without becoming pixel-identical.

- FawxzzyWeb owns the information hierarchy: branded shell, concise product context, one focused task surface, clear service status, and a simple route back home.
- Fitness owns the interaction rhythm: centered fields, restrained copy, strong primary action, generous spacing, safe-area-aware mobile behavior, and minimal visual noise.
- Each product owns its background, accent palette, iconography, and product-specific wording.
- Capability truth wins over visual consistency. A product must never show an enabled action when its account adapter or service registration is unavailable.

## Required anatomy

Every sign-in and create-account surface provides these elements in this order:

1. Product identity and a clear home/back action.
2. App-specific eyebrow, title, and one short supporting sentence.
3. Sign-in/create-account mode control when both actions share a route.
4. Explicit availability or recovery state before submission.
5. Labeled identifier and password controls with password-manager semantics.
6. One dominant submit action with a visible disabled and pending state.
7. Secondary recovery, legal, or account-status actions after the primary task.

The family requires 44px minimum interactive targets, visible keyboard focus, no horizontal overflow at 320px, reduced-motion support, and safe-area-aware vertical spacing.

## Product variants

### FawxzzyWeb

- Product marker: `Fawxzzy account`.
- Background: Fawxzzy wolf-brand charcoal, sage, and soft neutral light fields.
- Desktop: split identity and credentials layout.
- Mobile: one-column flow with the same task order.
- Current service boundary: account actions remain visibly unavailable unless the approved adapter resolves at runtime.

### Fitness

- Preserve the existing Fitness auth shell, field treatment, bottom action rhythm, and green fitness background.
- Copy may name Fitness-specific account outcomes.
- Do not restyle the active login route while another exact writer owns it. Reconcile that work first, then change only proven contract gaps.

### Mazer

- Implement the same anatomy inside the Phaser runtime rather than importing Website or Fitness components.
- Background: Mazer's own game/menu scene, bounded by a dimmer and readable auth surface.
- Preserve one overlay, current gameplay state, and recoverable input behavior.
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

1. FawxzzyWeb may adopt this contract from an isolated exact-main worktree.
2. Fitness remains the visual anchor until its active login-route writer is reconciled.
3. Mazer remains implementation-held until its active auth/menu writer is reconciled.
4. Each product requires its own focused tests, responsive screenshots, exact-head review, and separately authorized release.

This contract grants no commit, push, pull-request, merge, provider, deployment, or production authority.
