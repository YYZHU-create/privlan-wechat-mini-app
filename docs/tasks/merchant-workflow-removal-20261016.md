# Merchant Workflow removal — 2026-10-16

Request: remove the merchant Workflow feature selected by the user. Scope: remove navigation item,view allowlist entry,title,state,definition/run/capability fetches,creation/status actions,and rendered section/drawer. Existing ?view=workflow resolves tooverview through established invalid-view fallback;switchView cannotreopenremovedview. Other navigation unchanged. Workflow backend/domain integrations/tables retained toavoidunrelateddataorserviceimpact;this is merchantfrontendremoval,notbackenddecommission.

Newtests baseline3total1pass2fail;changedfocused9PASS;syntaxPASS;fulladmin619total615pass0fail4skip exit0. Tested rollback onanothercopy restoresoriginalhashandbaselinebehavior. No browser visual acceptance performed. NoMeoo sync/deploy,databaseorcredentialchanges. Production13 stillservespreviousapplicationuntila separatelygatedrelease.

Nextrelease remains subject to currentMiseadaptation,Stagingacceptance,andexistingProductionstability/releaseauthorizationboundaries. GitHubpushdoesnotdeploy.
