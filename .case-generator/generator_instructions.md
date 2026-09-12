# Daily Medical Coding Case Study Generator

This file is the durable operating specification for scheduled and manual case generation in this Obsidian vault. The clinical cases are fictional practice documentation. The learner performs all coding independently.

## Locations and preservation

- Treat the nearest ancestor containing `.obsidian` as the vault root.
- Store new and active notes under the existing `Medical Coding/Case Study/` hierarchy, with `Simple/`, `Intermediate/`, and `Complex/` subfolders.
- Store completed notes under `Medical Coding/Case Study/Archive/`, preserving the same `Simple/`, `Intermediate/`, and `Complex/` subfolder structure. Pending or in-progress notes must not be placed in the archive.
- Store generator state, private answer keys, and practice-app generation requests only under `Medical Coding/.case-generator/`.
- Read the matching template in `Templates/Case Study Templates/` before generation. Preserve compatible clinical field conventions, but omit its answer-entry block from generated case files.
- Never delete or overwrite an existing case, learner answer, template, note, or unrelated file.
- Before writing, inspect `state.json`, `case_registry.json`, the matching file under `answer_keys/`, `generation_requests.json` when present, recent active and archived cases, and relevant legacy cases.

## Private answer rule

Public case Markdown must never contain solution codes. Store canonical answers only in the matching ignored local file `.case-generator/answer_keys/<difficulty>.json`, keyed by `case_id`. Each answer-key file must contain cases from exactly one difficulty. Do not place codes, partial codes, ranges, families, modifiers, suggested answers, lookup terms, index or tabular directions, proprietary descriptors, or coding hints in filenames, frontmatter, clinical narrative, headings, comments, metadata, footnotes, or other public files.

- `cpt` contains only CPT codes for procedures actually performed to establish the diagnosis. Do not separately code incidental examination elements. The only exception is a case explicitly focused on patient evaluation, management, or admission; in that situation, include an exact E/M or admission code only when the narrative documents every detail required to select it.
- `icd10` contains only reportable diagnosis codes supported by the documentation.
- `hcpcs` contains only HCPCS Level II codes for sufficiently documented supplies or services.
- Include `icd10`, `cpt`, and `hcpcs` arrays for every case. Use an empty array when no supported code applies in a category; never substitute explanatory text such as `N/A`.
- When exact code selection depends on details such as imaging views, technique, patient status, time, setting, quantity, or material, document those details naturally in the clinical record. Do not guess an exact code from incomplete documentation.
- Verify answers against authoritative code-set information effective for the case's service date.

Use this private structure:

```json
{
  "version": 1,
  "difficulty": "intermediate",
  "cases": {
    "CASE-0024": {
      "icd10": ["private code"],
      "cpt": ["private code"],
      "hcpcs": []
    }
  }
}
```

Never include private answer values in chat confirmations or generation summaries.

Clinical terminology and realistic documentation are required. Do not visually emphasize details because they may matter to coding. Write laterality, anatomy, severity, technique, devices, quantities, route, setting, and encounter circumstances naturally without explaining their coding significance.

Use general clinical knowledge. Do not copy or reverse-engineer proprietary reference descriptions, commercial textbooks, or uploaded coding books. Prefer authoritative public sources when verifying code validity and effective dates.

## Identification and metadata

- Assign the next unused sequential ID in the form `CASE-0001`, `CASE-0002`, and so on. Never reuse an ID.
- Save each case in its own file named only `CASE-####.md`.
- Use the next number in `case_registry.json`, while also checking the filesystem for collisions. If a target exists, advance to the next free number.
- New cases always have `type: case-study`, `status: pending`, an empty `date:`, an empty `time:`, an empty `Google Help:`, and a `generated_date` matching the generation date.
- `time` records the learner's time spent on the case. `Google Help` records the learner's Google-help count. The generator must leave both empty and must never overwrite learner-entered values.
- When the learner achieves a full verified match, set `status: completed` and `date:` to the actual completion date in `YYYY-MM-DD` format. Preserve `generated_date`; the dashboard counts `date`, not `generated_date`.
- Only after a full verified match may the note be moved into the matching `Case Study/Archive/<Difficulty>/` folder and its path updated in `case_registry.json`. Preserve the filename, case ID, clinical content, and learner-entered values. If the learner misses any category, keep the note pending, record the failed attempt, and return it to the practice pool. If a system answer is corrected, save the correction and requeue the case for another attempt.

Use this frontmatter unless a compatible template requirement adds a non-conflicting property:

```yaml
---
type: case-study
case_id: CASE-####
difficulty: simple | intermediate | complex
coding_area: "selected coding area"
specialty: "selected specialty or general"
status: pending
date:
generated_date: YYYY-MM-DD
time:
Google Help:
---
```

## Scheduled daily workflow

A scheduled run creates at most one daily request and never creates a case before the learner selects difficulty.

At the start of a scheduled run:

1. Read `state.json` and `case_registry.json`.
2. Check both the registry and filesystem for a daily case already generated for the scheduled local date.
3. If that daily case exists, do not generate another. Report only its case ID and location.
4. If the same date already has a pending daily request, do not create a duplicate request.
5. Otherwise write a pending request to `state.json` with request type `daily`, the scheduled date, status `awaiting_difficulty`, and requested count `1`.
6. Ask exactly: `What difficulty should today's case be?`
7. Present only: `1. Simple`, `2. Intermediate`, `3. Complex`, `4. Random`.
8. Stop and wait. Do not select a difficulty or generate a case.

When the learner replies with one of those choices or an obvious equivalent, continue the pending request. For Random, choose Simple, Intermediate, or Complex without weighting. Generate exactly one case, perform quality control, save it, update the registry, record the completed daily run, and clear the pending request. Confirm only the case ID, actual difficulty, and file location.

Never reuse yesterday's choice. Never create two daily cases because a scheduled run restarted.

## Practice-app generation queue

The local practice app records **Request More Cases** actions in `.case-generator/generation_requests.json`. On a manual generator run, process pending requests in creation order. Each request provides a specific difficulty and count (normally 100). Generate exactly that amount using the normal manual workflow, then mark the request `completed` with a completion timestamp. If interrupted, preserve already generated cases, record progress on the request, and resume at the next unused case ID. Do not mark a request completed until every requested public case and private answer record has been saved.

## Manual requests

- Manual generation is separate from the daily workflow and is allowed even when a daily case exists.
- If the learner specifies a count, use it. If the learner asks for additional cases without a count, default to 100. An explicitly singular request means one case.
- If difficulty is specified, use it. If mixed difficulty is requested, distribute cases across all three levels. If difficulty is omitted, ask `What difficulty should I use?` with only Simple, Intermediate, Complex, and Random, then stop.
- If the immediately preceding interaction establishes difficulty unambiguously and the learner asks for another singular case, reuse that difficulty.
- Honor requested constraints such as specialty, setting, age range, gender, body system, disease family, procedure type, diagnosis focus, procedure focus, supply-heavy documentation, pediatrics, geriatrics, trauma, inpatient only, outpatient only, surgery only, or no surgery when medically reasonable and consistent with the private answer rule.

## Coding areas and specialties

When not specified, use controlled variety among these areas: inpatient hospital, hospital outpatient, emergency department, physician or professional services, ambulatory surgery center, observation services, urgent care, primary care, specialty clinics, radiology, pathology and laboratory, anesthesia, behavioral health, rehabilitation therapy, home health, hospice and palliative care, skilled nursing facility, long-term care, durable medical equipment, ambulance services, dental or oral surgery, and telehealth.

For small batches, avoid immediate repeats when alternatives fit. For large batches, establish broad coverage first, shuffle the sequence, allow realistic repetition, and prevent any one area from dominating.

Mix general documentation with clinically appropriate specialty cases. Available specialties include cardiology, orthopedics, oncology, obstetrics and gynecology, pediatrics, general surgery, neurosurgery, gastroenterology, urology, pulmonology, nephrology, dermatology, ophthalmology, ear nose and throat, pain management, endocrinology, infectious disease, trauma, and transplant services. Do not force a specialty onto every case. A 100-case mixed batch should include every specialty at least once where clinically appropriate.

## Difficulty formats

### Simple

Use exactly these body labels:

**Patient:**  
[Fictional patient name or initials]

**Gender:**  
[Gender]

**Age:**  
[Age]

**Chief Complaint:**  
[Brief complaint]

**Medical History:**  
[Relevant history or "None reported."]

**Assessment and Diagnosis:**  
[Assessment and diagnosis]

Keep the principal scenario and assessment straightforward, each about one to three sentences. Usually include one primary diagnosis and at most one necessary secondary condition. Avoid distractors and procedure overload. Simple cases primarily develop diagnosis interpretation.

### Intermediate

Use exactly these body labels:

**Patient:**  
[Fictional patient name or initials]

**Gender:**  
[Gender]

**Age:**  
[Age]

**Case Report:**  
[Clinical narrative]

Write third-person clinical narrative or impersonal passive voice. Naturally include complaint, relevant history, symptoms, examination, useful diagnostic findings, assessment, confirmed diagnosis, and a service or procedure. Do not create coding-clue subsections. Inpatient cases may contain only minor inpatient procedures; outpatient cases may contain any clinically reasonable outpatient procedure. Include supplies or services only when natural.

### Complex

Use the same Patient, Gender, Age, and Case Report labels as Intermediate. Write a detailed continuous professional record in third person or impersonal passive voice. Include only clinically relevant elements from history, illness course, symptoms, examination, testing, diagnoses, procedures, anatomy, laterality, technique, treatment, medications, materials, supplies, devices, implants, equipment, complications, post-procedure status, disposition, and follow-up. Complexity must come from interacting diagnoses, services, materials, settings, or circumstances—not deficient documentation.

## Clinical and educational quality

- Make age, sex or gender, presentation, diagnosis, testing, procedure, materials, specialty, medications, sequence, setting, and disposition mutually plausible.
- Simple cases contain little or no irrelevant detail. Intermediate cases contain limited realistic secondary information. Complex cases may contain realistic distractors, but never medically false information added to trick the learner.
- Vary coding area, specialty, demographics, presentation, history, testing, procedures, treatment, materials, severity, and disposition while maintaining compatibility.
- Repeated diagnoses are eventually acceptable, but avoid substantially identical combinations of diagnosis, procedure, specialty, area, demographics, presentation, or technique.
- For large batches, create and validate one separate note at a time. Preserve completed files if interrupted and resume at the next unused ID.

## Required ending

Every public case ends with exactly:

## Your Task

Using your current coding references, review the clinical documentation and determine the applicable coding based solely on the information provided.

Do not add answer fields, codes, hints, explanations, references, descriptors, or other material after that sentence. Save the corresponding answer in the private registry as part of the same generation operation.

## Save-time validation

Before every save, silently verify that the public Markdown contains no code, partial code, range, modifier, lookup hint, answer, proprietary descriptor, or artificial clue emphasis; the private answer entry contains all three answer arrays; its answer-key file declares and contains only the case's difficulty; CPT answers follow the diagnostic-procedure rule and the E/M or admission exception; every exact private code is supported by the narrative and effective for the service date; the filename and metadata reveal no answer; the clinical record is plausible; diagnosis, procedure, materials, setting, specialty, and difficulty align; required fields exist; the case differs sufficiently from recent cases; the ID is unique; existing files remain protected; status is pending; date, time, and Google Help are empty; and exactly the requested number of notes will be created.

After each successful case, save its private answer record, append non-answer duplicate-detection metadata to `case_registry.json`, advance `next_case_number`, and update `state.json` atomically enough that an interrupted run can resume without overwriting a file. If any part fails, do not leave a public case without its private key or a key without its public case.
