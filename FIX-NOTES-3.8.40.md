# SmartMail Ops v3.8.40 — Review Board Origin Hard Fix

## Fixed
- Fixed Review cards still starting from the lower-left corner when only a small number of messages are visible.
- Replaced the Review card board's final layout primitive from CSS Grid to an explicit wrapping Flex surface.
- The board now has a single deterministic origin: **top-left**.
- Empty viewport space is always left below the cards, never above them.

## Why the earlier fix was insufficient
The Review page has accumulated several historical layout layers. Some rules treated the board as a six-row grid, later rules converted the Review shell to flex, while other rules retained a full-height grid queue with implicit rows. Adding `align-content:start` to only the grid layer did not remove that structural ambiguity.

v3.8.40 removes the ambiguity at the card collection level:
- `display:flex`
- `flex-flow:row wrap`
- `justify-content:flex-start`
- `align-content:flex-start`
- `align-items:flex-start`

Cards receive deterministic responsive flex bases:
- wide screen: 5 columns
- standard desktop: 4 columns
- <=1180px: 3 columns
- <=820px: 2 columns
- <=560px: 1 column

The existing card collision protections and v3.8.39 attachment transaction barrier are retained.
