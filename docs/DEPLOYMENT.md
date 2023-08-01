# Deploying Ceramic Anchor Service

Note: Ceramic Anchor Service, or CAS, is currently run only by 3box labs

These instructions will work generally for any github-hosted copy of this repo, however at this time we do not recommend that other ceramic users run their own CAS nodes.

## Github Actions

The available github actions are controlled by the files in [.github/workflows](../.github/workflows)

The *Publish Release* action causes github to merge changes to the selected target and to run `npm release`,
which in turn triggers a separate workflow that deploys to the 3box infrastructure.

Available targets are listed as "Type of publish"

 - rc     : will merge develop to release-candidate and deploy to Clay
 - main   : will merge release-candidate to main and deploy to Mainnet
 - both   : will merge to release-candidate and mainnet and deploy to both Clay and Mainnet
 - hotfix : will build the release from the current main branch 

In all cases where the main branch is in use, the main branch will also be merged down to release-candidate, and release-candidate will be merged down to develop

## Making Changes - Norms

1) all changes should first be submtted as a PR to *develop* branch and should be reviewed before merge

2) at least once a week, and possibly more often, the *rc* target should be built and deployed to Clay.  This action may be taken by any CAS developer but should check in discord first with the on-call and CAS team

3) at least one day after changes have been deployed to Clay, they may be deployed to Mainnet by building the *main* target
All developers who have changes in the changeset should be alerted and oncall and at least one core CAS developer should approve builds to main.

