# Touchline on GitHub Pages

## Publish from your `Touchline` repository

1. Extract the ZIP. The site files are at the top level of the archive.
2. Open your `Touchline` repository on GitHub. Select **Add file**, then **Upload files**. Drag in `index.html`, `assets/`, `results/`, `.nojekyll`, and this README. Keep the folder structure intact. If the repository already has a README you want to keep, skip this one.
3. Commit the upload to `main` or your chosen publishing branch. If GitHub asks you to propose the changes in a new branch, merge the pull request into the publishing branch.
4. Confirm that `index.html`, `assets/`, and `results/` are visible at the top level of the branch. If `.nojekyll` was hidden during upload, add a file named `.nojekyll` using **Add file → Create new file** and commit it.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main` and `/(root)`, then select **Save**.
6. Once the Pages deployment finishes, select **Visit site** on the Pages settings screen. For a project repository named `Touchline`, the usual address is `https://YOUR-USERNAME.github.io/Touchline/`.
7. Open **Results** to start the first MFL check. The match list loads ahead of the reports. Use **Check now** to refresh manually.

You can publish these files directly. GitHub Pages on the Free plan requires a public repository. Pages sites are generally public even when the repository is private. [GitHub Pages publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Match history and backups

The site retrieves public MFL data for Players, Clubs, Progression, and Results. Results checks the four tracked clubs when you open the page and a check is due, then every six hours while the page is visible. Official imports use the approved numbered leagues and cup tiers, starting from 23 September 2026 for a fresh browser.

The published site stores its match history in your browser. Use **Results → Downloads** to save a JSON match backup and restore it on another device. To bring over match records with complete stats from the original Touchline site, open **Results → Downloads** there and download its match backup. Then choose that JSON file under **Restore from a backup** on the GitHub Pages site.
