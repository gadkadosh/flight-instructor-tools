# Flight Instructor Tools

Tools for reducing the paperwork involved in my work as a freelance flight instructor.

- [CLI](cli/): the existing Go tool for validating session records and generating monthly invoices and duty reports. Run its commands from `cli/`.
- [Photo-entry app](app/): a local Next.js workspace for uploading handwritten school sheets, trying ChatGPT-plan or local Ollama extraction, reviewing drafts beside the originals, and explicitly confirming teaching records. Invoicing and logbook exports are deferred.

The app is an independent experiment. The CLI's billing rules, examples, and invoice layout are useful references; its implementation and input format do not constrain the app's design. Each tool owns its dependencies, build, tests, and usage documentation.

Licensed under the [MIT License](LICENSE.md).
