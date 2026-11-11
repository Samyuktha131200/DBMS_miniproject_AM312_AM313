# Data dictionary

Every table and column in the MySQL database `hospital_emergency_management`, generated from [`01_schema.sql`](../01_schema.sql). For the MongoDB collections, see [`mongodb/docs/DATA_MODEL.md`](../mongodb/docs/DATA_MODEL.md) §2.

Key: **PK** primary key, **FK** foreign key, **UQ** unique, **NN** NOT NULL, **AI** AUTO_INCREMENT.

## PATIENT

A person who comes to the emergency department.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `patient_id` | INT | PK AI NN |  |  | Unique patient number |
| `first_name` | VARCHAR(50) | NN |  |  | Given name |
| `last_name` | VARCHAR(50) | NN |  |  | Family name |
| `dob` | DATE | NN |  |  | Date of birth |
| `gender` | CHAR(1) | NN |  | CHECK `(gender IN ('M','F','O'))` | M, F or O |
| `blood_group` | VARCHAR(5) | null |  |  | e.g. O+, AB- |
| `phone` | VARCHAR(15) | null |  |  | Patient contact number |
| `address` | VARCHAR(200) | null |  |  | Home address |
| `emergency_contact_name` | VARCHAR(100) | null |  |  | Person to call in an emergency |
| `emergency_contact_phone` | VARCHAR(15) | null |  |  | Their phone number |

Indexes: `idx_patient_name` (last_name, first_name).

## DEPARTMENT

A hospital department (e.g. Emergency, Cardiology).

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `department_id` | INT | PK AI NN |  |  | Unique department number |
| `dept_name` | VARCHAR(50) | UQ NN |  |  | Department name |
| `location` | VARCHAR(50) | null |  |  | Floor / block |
| `head_doctor_id` | INT | FK UQ null |  | FK → DOCTOR.doctor_id (on delete SET NULL), added by ALTER TABLE | Doctor who heads the department (HEADS, 1:1) |

`head_doctor_id` FK is added afterwards with `ALTER TABLE` because DOCTOR and DEPARTMENT refer to each other.

## DOCTOR

A doctor working in one department.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `doctor_id` | INT | PK AI NN |  |  | Unique doctor number |
| `name` | VARCHAR(100) | NN |  |  | Full name |
| `specialization` | VARCHAR(50) | null |  |  | Medical specialty |
| `phone` | VARCHAR(15) | null |  |  | Contact number |
| `shift_timing` | VARCHAR(20) | null |  |  | Usual shift |
| `availability_status` | VARCHAR(20) | NN | `'Available'` | CHECK `(availability_status IN ('Available','Busy','Unavailable'))` | Available, Busy or Unavailable |
| `department_id` | INT | FK NN |  | FK → DEPARTMENT.department_id (delete RESTRICT) | Home department (EMPLOYS) |

## NURSE_STAFF

A nurse, paramedic or technician working in one department.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `staff_id` | INT | PK AI NN |  |  | Unique staff number |
| `name` | VARCHAR(100) | NN |  |  | Full name |
| `role` | VARCHAR(30) | NN |  |  | Nurse, Head Nurse, Paramedic or Technician |
| `phone` | VARCHAR(15) | null |  |  | Contact number |
| `shift_timing` | VARCHAR(20) | null |  |  | Usual shift |
| `department_id` | INT | FK NN |  | FK → DEPARTMENT.department_id (delete RESTRICT) | Home department (STAFFED_BY) |

## AMBULANCE

An ambulance vehicle and its driver.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `ambulance_id` | INT | PK AI NN |  |  | Unique ambulance number |
| `vehicle_number` | VARCHAR(20) | UQ NN |  |  | Registration plate |
| `driver_name` | VARCHAR(100) | null |  |  | Driver on duty |
| `driver_phone` | VARCHAR(15) | null |  |  | Driver contact number |
| `status` | VARCHAR(20) | NN | `'Available'` | CHECK `(status IN ('Available','On Call','Under Maintenance'))` | Available, On Call or Under Maintenance |

## HOSPITAL_BED

A bed that belongs to a department.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `bed_id` | INT | PK AI NN |  |  | Unique bed number |
| `ward_type` | VARCHAR(30) | NN |  |  | Emergency, General, ICU or Orthopedic |
| `status` | VARCHAR(20) | NN | `'Available'` | CHECK `(status IN ('Available','Occupied','Maintenance'))` | Available, Occupied or Maintenance (kept in step with cases by triggers) |
| `department_id` | INT | FK NN |  | FK → DEPARTMENT.department_id (delete RESTRICT) | Department that owns the bed (HAS_BED) |

Indexes: `idx_bed_status` (status).

## EMERGENCY_CASE

One emergency visit by a patient; the centre of the schema.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `case_id` | INT | PK AI NN |  |  | Unique case number (MongoDB documents refer to this) |
| `arrival_time` | DATETIME | NN | `CURRENT_TIMESTAMP` |  | When the patient arrived |
| `arrival_mode` | VARCHAR(30) | NN |  |  | Ambulance or Walk-in |
| `chief_complaint` | VARCHAR(255) | null |  |  | Main reason for the visit |
| `triage_level` | INT | NN |  | CHECK `(triage_level BETWEEN 1 AND 5)` | Urgency, 1 (most urgent) to 5 |
| `case_status` | VARCHAR(30) | NN | `'Open'` | CHECK `(case_status IN ('Open','Under Treatment','Admitted','Discharged','Closed'))` | Open, Under Treatment, Admitted, Discharged or Closed |
| `ambulance_id` | INT | FK null |  | FK → AMBULANCE.ambulance_id (delete SET NULL) | Ambulance that brought the patient (TRANSPORTS); NULL for walk-ins |
| `patient_id` | INT | FK NN |  | FK → PATIENT.patient_id (delete RESTRICT) | The patient (REGISTERS) |
| `bed_id` | INT | FK null |  | FK → HOSPITAL_BED.bed_id (delete SET NULL) | Assigned bed (ASSIGNED_TO); NULL until a bed is given |

Indexes: `idx_case_arrival` (arrival_time), `idx_case_status` (case_status), `idx_case_triage` (triage_level).

## TREATMENT

A treatment given to a case by a doctor.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `treatment_id` | INT | PK AI NN |  |  | Unique treatment number |
| `treatment_description` | VARCHAR(255) | null |  |  | What was done |
| `start_time` | DATETIME | NN | `CURRENT_TIMESTAMP` | CHECK `(end_time IS NULL OR end_time >= start_time)` | Start of treatment |
| `end_time` | DATETIME | null |  | CHECK `(end_time IS NULL OR end_time >= start_time)` | End of treatment; NULL while ongoing |
| `doctor_id` | INT | FK NN |  | FK → DOCTOR.doctor_id (delete RESTRICT) | Doctor who gave it (ADMINISTERS) |
| `case_id` | INT | FK NN |  | FK → EMERGENCY_CASE.case_id (delete CASCADE) | Case treated (RECEIVES) |

Indexes: `idx_treatment_case` (case_id).

## MEDICINE

A medicine in the pharmacy catalogue.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `medicine_id` | INT | PK AI NN |  |  | Unique medicine number |
| `medicine_name` | VARCHAR(100) | NN |  |  | Medicine name |
| `type` | VARCHAR(50) | null |  |  | Drug class, e.g. Antibiotic, Analgesic |
| `manufacturer` | VARCHAR(100) | null |  |  | Maker |
| `stock_quantity` | INT | NN | `0` | CHECK `(stock_quantity >= 0)` | Units in stock (never negative: CHECK + trigger) |
| `unit_price` | DECIMAL(10,2) | NN | `0` | CHECK `(unit_price >= 0)` | Price per unit |

Indexes: `idx_medicine_name` (medicine_name).

## DIAGNOSTIC_TEST

A test the hospital can perform.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `test_id` | INT | PK AI NN |  |  | Unique test number |
| `test_name` | VARCHAR(100) | NN |  |  | Test name, e.g. ECG |
| `test_type` | VARCHAR(50) | null |  |  | Category, e.g. Imaging |
| `cost` | DECIMAL(10,2) | NN | `0` | CHECK `(cost >= 0)` | Price of the test |

## PRESCRIPTION

A medicine prescribed for a case (associative entity: case + doctor + medicine).

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `prescription_id` | INT | PK AI NN |  |  | Unique prescription number |
| `dosage` | VARCHAR(100) | NN |  |  | Amount per dose |
| `frequency` | VARCHAR(100) | NN |  |  | How often |
| `date_issued` | DATETIME | NN | `CURRENT_TIMESTAMP` |  | When prescribed |
| `case_id` | INT | FK NN |  | FK → EMERGENCY_CASE.case_id (delete CASCADE) | Case (CASE_RX) |
| `medicine_id` | INT | FK NN |  | FK → MEDICINE.medicine_id (delete RESTRICT) | Medicine (MED_RX) |
| `doctor_id` | INT | FK NN |  | FK → DOCTOR.doctor_id (delete RESTRICT) | Prescribing doctor (DOCTOR_RX) |

Indexes: `idx_prescription_case` (case_id).

## TEST_ORDER

A diagnostic test ordered for a case (associative entity: case + doctor + test).

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `test_order_id` | INT | PK AI NN |  |  | Unique order number |
| `order_time` | DATETIME | NN | `CURRENT_TIMESTAMP` |  | When ordered |
| `result_status` | VARCHAR(30) | NN | `'Ordered'` | CHECK `(result_status IN ('Ordered','In Progress','Completed','Cancelled'))` | Ordered, In Progress, Completed or Cancelled |
| `result_value` | VARCHAR(255) | null |  |  | Result text, once completed |
| `case_id` | INT | FK NN |  | FK → EMERGENCY_CASE.case_id (delete CASCADE) | Case (CASE_ORD) |
| `doctor_id` | INT | FK NN |  | FK → DOCTOR.doctor_id (delete RESTRICT) | Ordering doctor (DOCTOR_ORD) |
| `test_id` | INT | FK NN |  | FK → DIAGNOSTIC_TEST.test_id (delete RESTRICT) | Test (TEST_ORD) |

Indexes: `idx_test_order_case` (case_id).

## BILLING

The bill for a case (at most one per case).

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `bill_id` | INT | PK AI NN |  |  | Unique bill number |
| `total_amount` | DECIMAL(10,2) | NN | `0` | CHECK `(total_amount >= 0)` | Amount billed |
| `payment_status` | VARCHAR(20) | NN | `'Pending'` | CHECK `(payment_status IN ('Pending','Partially Paid','Paid'))` | Pending, Partially Paid or Paid |
| `payment_mode` | VARCHAR(20) | null |  |  | Cash, Card, UPI, Insurance or Other |
| `bill_date` | DATETIME | NN | `CURRENT_TIMESTAMP` |  | When the bill was raised |
| `case_id` | INT | FK UQ NN |  | FK → EMERGENCY_CASE.case_id (delete RESTRICT) | Case billed (GENERATES, 1:1) |

## USER_ACCOUNT

A web login for one doctor or nurse.

| Column | Type | Keys / null | Default | Rules | Meaning |
|---|---|---|---|---|---|
| `user_id` | INT | PK AI NN |  |  | Unique account number |
| `username` | VARCHAR(50) | UQ NN |  |  | Login name, e.g. doctor1 |
| `password_hash` | VARCHAR(255) | NN |  | CHECK `(password_hash LIKE 'scrypt$%')` | Salted scrypt hash; the password itself is never stored |
| `role` | VARCHAR(10) | NN |  | CHECK `(role IN ('doctor','nurse'))`<br>CHECK `( (role = 'doctor' AND doctor_id IS NOT NULL AND staff_id IS NULL) OR (role = 'nurse' AND staff_id IS NOT NULL AND doctor_id IS NULL) )` | doctor or nurse |
| `doctor_id` | INT | FK UQ null |  | FK → DOCTOR.doctor_id<br>CHECK `( (role = 'doctor' AND doctor_id IS NOT NULL AND staff_id IS NULL) OR (role = 'nurse' AND staff_id IS NOT NULL AND doctor_id IS NULL) )` | Linked doctor (DOCTOR_LOGIN) when role = doctor |
| `staff_id` | INT | FK UQ null |  | FK → NURSE_STAFF.staff_id<br>CHECK `( (role = 'doctor' AND doctor_id IS NOT NULL AND staff_id IS NULL) OR (role = 'nurse' AND staff_id IS NOT NULL AND doctor_id IS NULL) )` | Linked nurse (NURSE_LOGIN) when role = nurse |
| `is_active` | BOOLEAN | NN | `TRUE` |  | FALSE blocks sign-in |
| `created_at` | DATETIME | NN | `CURRENT_TIMESTAMP` |  | When the account was made |
| `last_login` | DATETIME | null |  |  | Last successful sign-in |

Its FKs have no ON DELETE / ON UPDATE action because MySQL does not allow referential actions on columns used in a CHECK constraint.
