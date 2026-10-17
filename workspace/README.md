# workspace

The default `SPOOLDOC_WORKSPACE`. Spooldoc keeps its design-time files here:

- `samples/<id>.json`: captured spooled files (raw *SCS bytes, attributes and parsed pages).
- `definitions/<type>.yaml`: document definitions, one per document type.
- `templates/<type>.html`: templates that render the extracted JSON.

Everything in this folder except this README is ignored by git, because
samples captured from a real system can hold real data. Set
`SPOOLDOC_WORKSPACE` to keep the files somewhere else.
