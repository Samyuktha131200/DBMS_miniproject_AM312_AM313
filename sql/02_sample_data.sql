INSERT INTO patient (patient_name, age, gender, phone, blood_group, address) VALUES
('Arjun Rao', 35, 'Male', '9876500001', 'O+', 'Bengaluru'),
('Priya Sharma', 28, 'Female', '9876500002', 'A+', 'Mysuru'),
('Rahul Kumar', 45, 'Male', '9876500003', 'B+', 'Bengaluru'),
('Ananya Reddy', 22, 'Female', '9876500004', 'AB+', 'Tumakuru'),
('Vikram Singh', 60, 'Male', '9876500005', 'O-', 'Bengaluru'),
('Sneha Nair', 31, 'Female', '9876500006', 'A-', 'Kochi'),
('Kiran Patel', 50, 'Male', '9876500007', 'B-', 'Bengaluru'),
('Meera Iyer', 40, 'Female', '9876500008', 'O+', 'Chennai'),
('Rohan Das', 19, 'Male', '9876500009', 'AB-', 'Bengaluru'),
('Divya Menon', 55, 'Female', '9876500010', 'A+', 'Mangaluru');

INSERT INTO doctor (doctor_name, specialization, phone, availability_status) VALUES
('Dr. Amit Rao', 'Emergency Medicine', '9811000001', 'Available'),
('Dr. Kavya Shetty', 'Cardiology', '9811000002', 'Busy'),
('Dr. Ramesh Kumar', 'Orthopedics', '9811000003', 'Available'),
('Dr. Neha Reddy', 'Neurology', '9811000004', 'Available'),
('Dr. Sanjay Menon', 'General Medicine', '9811000005', 'Busy');

INSERT INTO ambulance (vehicle_number, driver_name, driver_phone, ambulance_status) VALUES
('KA01AB1001', 'Ravi Kumar', '9822000001', 'Available'),
('KA01AB1002', 'Suresh Rao', '9822000002', 'On Call'),
('KA01AB1003', 'Manoj Singh', '9822000003', 'Available'),
('KA01AB1004', 'Anil Das', '9822000004', 'Under Maintenance');

INSERT INTO bed (bed_number, bed_type, bed_status, location) VALUES
('G101', 'General', 'Occupied', 'Ground Floor'),
('G102', 'General', 'Available', 'Ground Floor'),
('E101', 'Emergency', 'Occupied', 'Emergency Ward'),
('E102', 'Emergency', 'Available', 'Emergency Ward'),
('I101', 'ICU', 'Occupied', 'ICU Block'),
('I102', 'ICU', 'Available', 'ICU Block'),
('G103', 'General', 'Available', 'First Floor'),
('G104', 'General', 'Occupied', 'First Floor'),
('I103', 'ICU', 'Maintenance', 'ICU Block'),
('E103', 'Emergency', 'Available', 'Emergency Ward');

INSERT INTO emergency_case
(patient_id, doctor_id, ambulance_id, arrival_time, emergency_type, case_description, case_status) VALUES
(1, 1, 2, '2026-10-24 08:30:00', 'Cardiac Emergency', 'Chest pain and breathlessness', 'Under Treatment'),
(2, 2, 1, '2026-10-24 09:00:00', 'Cardiac Emergency', 'Palpitations and dizziness', 'Admitted'),
(3, 3, 3, '2026-10-24 09:30:00', 'Accident', 'Leg injury following road accident', 'Under Treatment'),
(4, 1, NULL, '2026-10-24 10:00:00', 'Fever', 'High fever and dehydration', 'Discharged'),
(5, 4, 2, '2026-10-24 10:30:00', 'Neurological Emergency', 'Sudden severe headache', 'Admitted'),
(6, 5, NULL, '2026-10-24 11:00:00', 'Respiratory Emergency', 'Difficulty breathing', 'Under Treatment'),
(7, 3, 3, '2026-10-24 11:30:00', 'Fracture', 'Suspected arm fracture', 'Admitted'),
(8, 2, NULL, '2026-10-24 12:00:00', 'Cardiac Emergency', 'Chest discomfort', 'Closed'),
(9, 4, 1, '2026-10-24 12:30:00', 'Head Injury', 'Head injury after a fall', 'Under Treatment'),
(10, 5, NULL, '2026-10-24 13:00:00', 'Abdominal Emergency', 'Severe abdominal pain', 'Open');

INSERT INTO triage (case_id, severity, priority_level, symptoms, vital_signs) VALUES
(1, 'Critical', 1, 'Chest pain, breathlessness', 'BP 160/100, Pulse 115'),
(2, 'High', 2, 'Palpitations, dizziness', 'BP 145/95, Pulse 105'),
(3, 'High', 2, 'Leg pain, swelling', 'BP 130/85, Pulse 98'),
(4, 'Moderate', 3, 'Fever, dehydration', 'Temperature 102 F'),
(5, 'Critical', 1, 'Severe headache', 'BP 170/105'),
(6, 'High', 2, 'Difficulty breathing', 'Oxygen saturation 90%'),
(7, 'Moderate', 3, 'Arm pain, swelling', 'BP 125/80'),
(8, 'Low', 4, 'Mild chest discomfort', 'BP 120/80, Pulse 78'),
(9, 'High', 2, 'Head injury, dizziness', 'BP 140/90'),
(10, 'Moderate', 3, 'Abdominal pain', 'BP 125/85');

INSERT INTO treatment
(case_id, doctor_id, diagnosis, treatment_description, treatment_status) VALUES
(1, 1, 'Suspected acute cardiac event', 'Emergency cardiac assessment and monitoring', 'Ongoing'),
(2, 2, 'Cardiac arrhythmia', 'ECG and cardiac observation', 'Completed'),
(3, 3, 'Leg injury', 'Immobilization and orthopedic assessment', 'Ongoing'),
(4, 1, 'Acute febrile illness', 'Fluids and fever management', 'Completed'),
(5, 4, 'Severe headache under investigation', 'Neurological assessment and imaging', 'Ongoing'),
(6, 5, 'Respiratory distress', 'Oxygen support and monitoring', 'Ongoing'),
(7, 3, 'Suspected arm fracture', 'Splinting and X-ray assessment', 'Completed'),
(8, 2, 'Chest discomfort', 'Cardiac evaluation and observation', 'Completed'),
(9, 4, 'Head injury', 'Neurological monitoring', 'Ongoing'),
(10, 5, 'Abdominal pain', 'Clinical examination and diagnostic evaluation', 'Planned');

INSERT INTO medicine
(medicine_name, manufacturer, unit_price, stock_quantity, expiry_date) VALUES
('Paracetamol', 'ABC Pharma', 25.00, 100, '2027-12-31'),
('Aspirin', 'HealthCare Labs', 40.00, 80, '2027-08-31'),
('Amoxicillin', 'MediLife', 65.00, 60, '2027-10-31'),
('Ibuprofen', 'ABC Pharma', 35.00, 90, '2028-01-31'),
('Salbutamol', 'RespiraMed', 55.00, 45, '2027-11-30'),
('Omeprazole', 'MediLife', 30.00, 70, '2028-03-31'),
('Cetirizine', 'HealthCare Labs', 20.00, 100, '2027-09-30'),
('Metformin', 'ABC Pharma', 45.00, 50, '2028-02-29'),
('Ondansetron', 'MediLife', 50.00, 40, '2027-07-31'),
('Normal Saline', 'HospCare', 35.00, 120, '2027-12-31');

INSERT INTO treatment_medicine (treatment_id, medicine_id, quantity, dosage) VALUES
(1, 2, 1, 'As prescribed by doctor'),
(2, 2, 1, 'As prescribed by doctor'),
(3, 4, 2, 'As prescribed by doctor'),
(4, 1, 2, 'As prescribed by doctor'),
(5, 6, 1, 'As prescribed by doctor'),
(6, 5, 2, 'As prescribed by doctor'),
(7, 4, 1, 'As prescribed by doctor'),
(8, 2, 1, 'As prescribed by doctor'),
(9, 1, 1, 'As prescribed by doctor'),
(10, 9, 1, 'As prescribed by doctor'),
(4, 10, 2, 'As prescribed by doctor'),
(6, 10, 1, 'As prescribed by doctor');

INSERT INTO diagnostic_test
(case_id, test_name, test_result, test_status, test_cost) VALUES
(1, 'ECG', 'Abnormal rhythm detected', 'Completed', 800.00),
(2, 'ECG', 'Arrhythmia observed', 'Completed', 800.00),
(3, 'X-Ray Leg', 'Fracture suspected', 'Completed', 1200.00),
(4, 'Blood Test', 'Results within expected range', 'Completed', 500.00),
(5, 'CT Brain', 'No acute findings reported', 'Completed', 4500.00),
(6, 'Chest X-Ray', 'Pending clinical review', 'In Progress', 1500.00),
(7, 'X-Ray Arm', 'Fracture confirmed', 'Completed', 1000.00),
(8, 'ECG', 'No acute abnormality detected', 'Completed', 800.00),
(9, 'CT Brain', 'Under evaluation', 'In Progress', 4500.00),
(10, 'Ultrasound Abdomen', NULL, 'Ordered', 2500.00);

INSERT INTO billing
(case_id, consultation_charge, treatment_charge, diagnostic_charge, medicine_charge, total_amount, payment_status, payment_method) VALUES
(1, 500.00, 2500.00, 800.00, 40.00, 3840.00, 'Pending', 'Other'),
(2, 500.00, 2000.00, 800.00, 40.00, 3340.00, 'Paid', 'UPI'),
(3, 500.00, 1500.00, 1200.00, 70.00, 3270.00, 'Partially Paid', 'Card'),
(4, 300.00, 800.00, 500.00, 50.00, 1650.00, 'Paid', 'Cash'),
(5, 600.00, 3000.00, 4500.00, 30.00, 8130.00, 'Pending', 'Insurance'),
(6, 500.00, 1800.00, 1500.00, 70.00, 3870.00, 'Partially Paid', 'UPI'),
(7, 400.00, 1200.00, 1000.00, 35.00, 2635.00, 'Paid', 'Card'),
(8, 400.00, 900.00, 800.00, 40.00, 2140.00, 'Paid', 'Cash'),
(9, 600.00, 2500.00, 4500.00, 25.00, 7625.00, 'Pending', 'Other'),
(10, 400.00, 1000.00, 2500.00, 50.00, 3950.00, 'Pending', 'Other');
