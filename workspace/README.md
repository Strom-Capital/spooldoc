# workspace

Where the capture command line (`pnpm --filter @spooldoc/ibmi capture`) writes
samples. The web app does not use this folder: it keeps everything in its
database. The folder layout:

- `samples/<id>.json`: captured spooled files (raw *SCS bytes, attributes and parsed pages).
- `definitions/<type>.yaml`: document definitions, one per document type.
- `templates/<type>.html`: templates that render the extracted JSON.

Everything in this folder except this README is ignored by git, because
samples captured from a real system can hold real data.
