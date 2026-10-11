# legacy/ (v2 branch only)

Code from main ee57078 that targets the old database (CallRecord, FathomRecording,
ClientTranscript, LeadAlert, FollowupThread/Touch, CommissionRule, Commission,
FollowupPack/Star/LibraryScript, ExtractorFeedback, CoachProfile/Message, UserOffer,
User.crmPrefs) or depends on code that does. It does not compile against the v2
schema, so it is excluded from the build (tsconfig `exclude`, `.eslintignore`) and
kept here, with its original paths, only as a reference for porting in the next
PRs of the plan (Fathom client, gemini, practice/LiveKit, web-push quiet hours, etc.).

Nothing here runs. Each later PR ports what it needs into `src/` against the new
schema; when the last screen is ported this folder is deleted.
