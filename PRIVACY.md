# Privacy and educational case studies

Publish only fictional cases, appropriately anonymized educational cases, or publicly distributable educational material that you have permission to share.

Do not publish real patient-identifiable information, including:

- Patient names or dates of birth.
- Medical record numbers, insurance identifiers, or account numbers.
- Addresses, phone numbers, or email addresses.
- Identifiable photographs or protected patient information.
- Confidential employer or provider information.

Combinations of seemingly ordinary case details can also identify someone. Review note bodies, Properties, filenames, attachments, and Git changes before publishing. Only share educational materials when their distribution is permitted.

The dashboard publishes completion dates, daily counts, and the filenames, repository paths, and difficulty levels of completed cases so readers can open them on GitHub. It does not copy clinical text into the dashboard. The README preview contains dates and counts. **A public GitHub repository exposes all committed files and their history**, including the case notes opened through those links.

Automated tooling cannot guarantee that protected health information (PHI) has been removed. The repository owner must review content before publishing. Removing identifiers alone is not a claim that this project is HIPAA compliant.

The local practice application binds only to `127.0.0.1` and keeps answer keys, active-session state, generation requests, correction history, and study results under the ignored `.case-generator/` paths documented in the README. Do not remove those ignore rules or commit those files. The public dashboard receives completion counts and case references only; it does not receive the private answer registry or local result records.

This is a learning portfolio, not clinical advice or a substitute for current official coding guidance.
