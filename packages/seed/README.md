# @courmap/seed

CLI that downloads cedya77/anime-offline-database and Anime-Lists, joins them on AniDB ID and writes data/seeds/ with origin set. Not built yet: build step 5 in docs/SPEC.md.

Extension point: the builder loads any directory of work files with an origin label (see loadDataset in packages/builder), so seeds plug in as a second source next to data/works/ with manual files winning.
