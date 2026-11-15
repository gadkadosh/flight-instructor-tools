# Flight Instructor Tools

Tools for reducing the paperwork involved in my work as a freelance flight instructor.

- [CLI](cli/): the existing Go tool for validating session records and generating monthly invoices. Run its commands from `cli/`.
- [App experiment](app/): a new approach to turning photos of handwritten school sheets into reviewed teaching records, with invoicing and logbook exports as possible outputs. Scaffolding has not started.

The app is an independent experiment. The CLI's billing rules, examples, and invoice layout are useful references; its implementation and input format do not constrain the app's design. Each tool owns its dependencies, build, tests, and usage documentation.

Licensed under the [MIT License](LICENSE.md).
