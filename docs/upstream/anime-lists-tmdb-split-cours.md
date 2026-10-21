# Draft: Anime-Lists issue about split cours that TMDB keeps in one season

This is a draft for Xwolv to read, edit and submit himself to
https://github.com/Anime-Lists/anime-lists/issues. Nothing has been sent. Suggested title:
**TMDB mappings for some second cours point at a TMDB season 2 that does not exist**

---

Hello, and thank you for Anime-Lists. Courmap (https://courmap.com, an open numbering map for anime that
builds on your data) would not exist without it, and the file has saved us a great deal of work.

While checking our TMDB mappings against TMDB we found a group of entries (fourteen so far) where the TMDB season does not
seem to exist. They all follow the same pattern: the first cour is `tmdbseason="1"`, and the second cour is
`tmdbseason="2"` with no offset, but TMDB keeps both cours in a single season 1 (the episode numbers run on), so
there is no season 2 to map to. The fix looks like `tmdbseason="1"` with a `tmdboffset` equal to the first
cour's episode count. We checked each show by hand on TMDB.

Anime-Lists commit we looked at: `9ed90bf804bb24d58c99ea653e095194df494b52`.

## The fourteen second cours

| AniDB ID | Entry | Current | What TMDB shows | Proposed |
| --- | --- | --- | --- | --- |
| 18090 | Jigokuraku 2nd Season | `tmdbtv="117465" tmdbseason="2"` | [Hell's Paradise](https://www.themoviedb.org/tv/117465): season 1 with 25 episodes, no season 2 | `tmdbseason="1" tmdboffset="13"` (episodes 14 to 25) |
| 17630 | Sono Bisque Doll wa Koi wo Suru Season 2 | `tmdbtv="123249" tmdbseason="2"` | [My Dress-Up Darling](https://www.themoviedb.org/tv/123249): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 18576 | Ore dake Level Up na Ken Season 2: Arise from the Shadow | `tmdbtv="127532" tmdbseason="2"` | [Solo Leveling](https://www.themoviedb.org/tv/127532): season 1 with 25 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 25) |
| 18205 | Watashi no Shiawase na Kekkon 2nd Season | `tmdbtv="196944" tmdbseason="2"` | [My Happy Marriage](https://www.themoviedb.org/tv/196944): season 1 with 25 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 25) |
| 18862 | Bye Bye, Earth 2nd Season | `tmdbtv="214587" tmdbseason="2"` | [Bye Bye, Earth](https://www.themoviedb.org/tv/214587): season 1 with 20 episodes, no season 2 | `tmdbseason="1" tmdboffset="10"` (episodes 11 to 20) |
| 18725 | Sentai Daishikkaku 2nd Season | `tmdbtv="215799" tmdbseason="2"` | [Go! Go! Loser Ranger!](https://www.themoviedb.org/tv/215799): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 18713 | Unnamed Memory Act.2 | `tmdbtv="216272" tmdbseason="2"` | [Unnamed Memory](https://www.themoviedb.org/tv/216272): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 18559 | Kekkon Yubiwa Monogatari II | `tmdbtv="218493" tmdbseason="2"` | [Tales of Wedding Rings](https://www.themoviedb.org/tv/218493): season 1 with 25 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 25) |

| 18566 | Himesama "Goumon" no Jikan desu 2nd Season | `tmdbtv="229443" tmdbseason="2"` | [Tis Time for "Torture," Princess](https://www.themoviedb.org/tv/229443): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 18875 | Kinnikuman: Kanpeki Choujin Shiso-hen Season 2 | `tmdbtv="236000" tmdbseason="2"` | [Kinnikuman Perfect Origin Arc](https://www.themoviedb.org/tv/236000): season 1 with 22 episodes, no season 2 | `tmdbseason="1" tmdboffset="11"` (episodes 12 to 22) |
| 19060 | Dandadan 2nd Season | `tmdbtv="240411" tmdbseason="2"` | [Dan Da Dan](https://www.themoviedb.org/tv/240411): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 19072 | Puniru wa Kawaii Slime 2nd Season | `tmdbtv="241811" tmdbseason="2"` | [Puniru Is a Kawaii Slime](https://www.themoviedb.org/tv/241811): season 1 with 24 episodes, no season 2 | `tmdbseason="1" tmdboffset="12"` (episodes 13 to 24) |
| 18864 | Shoushimin Series 2nd Season | `tmdbtv="243501" tmdbseason="2"` | [SHOSHIMIN: How to Become Ordinary](https://www.themoviedb.org/tv/243501): season 1 with 22 episodes, no season 2 | `tmdbseason="1" tmdboffset="10"` (episodes 11 to 22) |
| 19423 | Vigilante: Boku no Hero Academia Illegals 2nd Season | `tmdbtv="280110" tmdbseason="2"` | [My Hero Academia: Vigilantes](https://www.themoviedb.org/tv/280110): season 1 with 26 episodes, no season 2 | `tmdbseason="1" tmdboffset="13"` (episodes 14 to 26) |
For every row the TMDB season 1 episode count equals the first cour plus this one, so the offset is simply the
number of episodes of the first cour. We have not changed anything about the TVDB side, which has a real season 2.

## One mapping that points at the wrong show

| AniDB ID | Entry | Current | What TMDB shows | Proposed |
| --- | --- | --- | --- | --- |
| 11843 | Bonobono (TV 2016) | `tmdbtv="66569" tmdbseason="2"` | [Bonobono](https://www.themoviedb.org/tv/66569) is the 1995 series, with only season 1 (48 episodes) | [BONO BONO](https://www.themoviedb.org/tv/66751), first aired 2016-04-02: `tmdbtv="66751" tmdbseason="1"` |

## Notes

- We found these with a weekly check that compares season episode counts, so there may well be more of the same
  kind (a second cour at `tmdbseason="2"` without an offset on a TMDB show that has no season 2). We did not search
  for them beyond the checker's reports and can share the method if it is useful.
- TMDB changes over time. Some shows may get a season 2 later, and then your current mapping would be right
  again. We are happy to recheck any entry on request.
- Courmap overrides these locally in the meantime, so nothing is urgent on our side.

Thank you again for maintaining this. If a pull request with the changes would be easier for you than an issue,
we are glad to prepare one.
