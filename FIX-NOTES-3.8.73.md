# Scheduling calendar update

- Replaced fixed day-interval scheduling with selectable weekdays (Monday–Friday).
- Added target-region local-time scheduling with IANA timezone conversion before writing to NetEase Mail.
- Added an optional inclusive blackout date range that the automatic planner skips.
- The same-school limit now applies per selected send day instead of an abstract +N-day cycle.
- Existing/manual scheduled times are shown in the selected region local time while execution keeps the converted NetEase-local timestamp.
- Calendar validation now checks selected weekdays, blackout ranges, recognized local holidays, same-school daily limits, and existing NetEase schedule collisions.
