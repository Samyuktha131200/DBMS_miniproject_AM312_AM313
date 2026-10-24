-- Sample data for Hospital Emergency Management System
-- Run after 01_schema.sql on a fresh database.
USE hospital_emergency_management;

INSERT INTO PATIENT
(patient_id, first_name, last_name, dob, gender, blood_group, phone, address,
 emergency_contact_name, emergency_contact_phone)
VALUES
(1,'Arjun','Rao','1998-04-12','M','O+','9876501001','Bengaluru','Ravi Rao','9876502001'),
(2,'Priya','Sharma','1987-11-03','F','A+','9876501002','Mysuru','Anita Sharma','9876502002'),
(3,'Rahul','Kumar','2001-06-25','M','B+','9876501003','Bengaluru','Suresh Kumar','9876502003'),
(4,'Ananya','Reddy','1995-02-14','F','AB+','9876501004','Tumakuru','Lakshmi Reddy','9876502004'),
(5,'Vikram','Singh','1976-09-19','M','O-','9876501005','Bengaluru','Meena Singh','9876502005'),
(6,'Sneha','Nair','2003-01-30','F','A-','9876501006','Mandya','Kavitha Nair','9876502006'),
(7,'Kiran','Patel','1968-07-08','M','B-','9876501007','Bengaluru','Nisha Patel','9876502007'),
(8,'Meera','Iyer','1992-12-22','F','O+','9876501008','Hosur','Lakshmi Iyer','9876502008'),
(9,'Rohan','Das','1983-05-17','M','AB-','9876501009','Bengaluru','Amit Das','9876502009'),
(10,'Divya','Menon','2000-08-05','F','A+','9876501010','Bengaluru','Ravi Menon','9876502010');

INSERT INTO DEPARTMENT (department_id, dept_name, location, head_doctor_id) VALUES
(1,'Emergency Medicine','Ground Floor',NULL),
(2,'Cardiology','First Floor',NULL),
(3,'Neurology','First Floor',NULL),
(4,'Orthopedics','Second Floor',NULL),
(5,'General Medicine','Ground Floor',NULL);

INSERT INTO DOCTOR
(doctor_id, name, specialization, phone, shift_timing, availability_status, department_id)
VALUES
(1,'Dr Amit Rao','Emergency Medicine','9888001001','Morning','Available',1),
(2,'Dr Kavya Shetty','Cardiology','9888001002','Day','Available',2),
(3,'Dr Ramesh Kumar','Neurology','9888001003','Night','Busy',3),
(4,'Dr Neha Reddy','Orthopedics','9888001004','Morning','Available',4),
(5,'Dr Sanjay Menon','General Medicine','9888001005','Day','Available',5),
(6,'Dr Farah Khan','Emergency Medicine','9888001006','Night','Busy',1),
(7,'Dr Vivek Iyer','Cardiology','9888001007','Evening','Available',2),
(8,'Dr Pooja Nair','General Medicine','9888001008','Morning','Unavailable',5);

UPDATE DEPARTMENT SET head_doctor_id = 1 WHERE department_id = 1;
UPDATE DEPARTMENT SET head_doctor_id = 2 WHERE department_id = 2;
UPDATE DEPARTMENT SET head_doctor_id = 3 WHERE department_id = 3;
UPDATE DEPARTMENT SET head_doctor_id = 4 WHERE department_id = 4;
UPDATE DEPARTMENT SET head_doctor_id = 5 WHERE department_id = 5;

INSERT INTO NURSE_STAFF
(staff_id, name, role, phone, shift_timing, department_id)
VALUES
(1,'Lakshmi Rao','Head Nurse','9899001001','Morning',1),
(2,'Anu Thomas','Nurse','9899001002','Day',1),
(3,'Megha Das','Nurse','9899001003','Night',2),
(4,'Sanjana Pai','Technician','9899001004','Morning',3),
(5,'Naveen Kumar','Nurse','9899001005','Evening',4),
(6,'Ritu Shah','Nurse','9899001006','Day',5),
(7,'Joseph Mathew','Paramedic','9899001007','Night',1),
(8,'Asha Menon','Technician','9899001008','Morning',2);

INSERT INTO AMBULANCE
(ambulance_id, vehicle_number, driver_name, driver_phone, status, patient_id)
VALUES
(1,'KA01AB1001','Manoj Kumar','9900001001','On Call',1),
(2,'KA01AB1002','Suresh Babu','9900001002','Available',2),
(3,'KA01AB1003','Ramesh Naik','9900001003','On Call',3),
(4,'KA01AB1004','Farhan Ali','9900001004','Available',4),
(5,'KA01AB1005','Deepak Rao','9900001005','On Call',5),
(6,'KA01AB1006','Kiran Joshi','9900001006','Available',6);

INSERT INTO HOSPITAL_BED (bed_id, ward_type, status, department_id) VALUES
(1,'Emergency','Occupied',1),
(2,'Emergency','Occupied',1),
(3,'ICU','Occupied',2),
(4,'General','Occupied',5),
(5,'ICU','Occupied',3),
(6,'Orthopedic','Occupied',4),
(7,'General','Occupied',5),
(8,'Emergency','Occupied',1),
(9,'ICU','Occupied',2),
(10,'General','Occupied',5),
(11,'Orthopedic','Available',4),
(12,'Emergency','Available',1);

INSERT INTO EMERGENCY_CASE
(case_id, arrival_time, arrival_mode, chief_complaint, triage_level, case_status, ambulance_id, patient_id, bed_id)
VALUES
(1,'2026-10-24 08:15:00','Ambulance','Chest pain and breathlessness',1,'Under Treatment',1,1,1),
(2,'2026-10-24 08:40:00','Walk-in','High fever and dehydration',3,'Admitted',2,2,2),
(3,'2026-10-24 09:05:00','Ambulance','Head injury after fall',2,'Under Treatment',3,3,3),
(4,'2026-10-24 09:25:00','Ambulance','Fractured left wrist',3,'Admitted',4,4,4),
(5,'2026-10-24 10:10:00','Ambulance','Severe abdominal pain',2,'Under Treatment',5,5,5),
(6,'2026-10-24 10:45:00','Walk-in','Allergic reaction',2,'Discharged',6,6,6),
(7,'2026-10-24 11:20:00','Walk-in','Dizziness and weakness',4,'Discharged',2,7,7),
(8,'2026-10-24 12:00:00','Ambulance','Breathing difficulty',1,'Under Treatment',1,8,8),
(9,'2026-10-24 12:30:00','Walk-in','Minor burn injury',4,'Closed',4,9,9),
(10,'2026-10-24 13:10:00','Walk-in','Migraine and nausea',5,'Closed',6,10,10);

INSERT INTO TREATMENT
(treatment_id, treatment_description, start_time, end_time, doctor_id, case_id)
VALUES
(1,'ECG monitoring and initial cardiac stabilization','2026-10-24 08:20:00',NULL,2,1),
(2,'IV fluids and fever management','2026-10-24 08:50:00','2026-10-24 11:00:00',5,2),
(3,'Neurological assessment and observation','2026-10-24 09:10:00',NULL,3,3),
(4,'Wrist immobilization and pain management','2026-10-24 09:35:00','2026-10-24 12:00:00',4,4),
(5,'Abdominal examination and pain control','2026-10-24 10:15:00',NULL,1,5),
(6,'Antihistamine administration and observation','2026-10-24 10:50:00','2026-10-24 11:30:00',6,6),
(7,'Hydration and vital sign monitoring','2026-10-24 11:25:00','2026-10-24 12:00:00',5,7),
(8,'Oxygen support and respiratory monitoring','2026-10-24 12:05:00',NULL,1,8),
(9,'Burn dressing and wound care','2026-10-24 12:35:00','2026-10-24 13:00:00',4,9),
(10,'Migraine symptom management','2026-10-24 13:15:00','2026-10-24 14:00:00',8,10);

INSERT INTO MEDICINE
(medicine_id, medicine_name, type, manufacturer, stock_quantity, unit_price)
VALUES
(1,'Paracetamol','Analgesic','ABC Pharma',250,2.50),
(2,'Normal Saline','IV Fluid','MediCare Labs',100,45.00),
(3,'Aspirin','Antiplatelet','HealthPlus',150,3.00),
(4,'Cetirizine','Antihistamine','Wellness Pharma',80,4.00),
(5,'Omeprazole','Antacid','ABC Pharma',60,6.50),
(6,'Amoxicillin','Antibiotic','MedLife',120,8.00),
(7,'Salbutamol','Bronchodilator','AirCare',45,12.00),
(8,'Ibuprofen','NSAID','HealthPlus',90,5.00),
(9,'Ondansetron','Antiemetic','MediCare Labs',55,7.50),
(10,'Dextrose','IV Fluid','Care Labs',35,38.00);

INSERT INTO DIAGNOSTIC_TEST (test_id, test_name, test_type, cost) VALUES
(1,'ECG','Cardiology',500.00),
(2,'Complete Blood Count','Laboratory',350.00),
(3,'CT Head','Imaging',2500.00),
(4,'Wrist X-Ray','Imaging',700.00),
(5,'Abdominal Ultrasound','Imaging',1800.00),
(6,'Allergy Panel','Laboratory',1200.00),
(7,'Blood Glucose','Laboratory',150.00),
(8,'Chest X-Ray','Imaging',650.00),
(9,'Burn Assessment','Clinical',300.00),
(10,'Neurological Examination','Clinical',400.00);

INSERT INTO PRESCRIPTION
(prescription_id, dosage, frequency, date_issued, case_id, medicine_id, doctor_id)
VALUES
(1,'75 mg','Once daily','2026-10-24 08:30:00',1,3,2),
(2,'1 L IV','As prescribed','2026-10-24 08:55:00',2,2,5),
(3,'500 mg','Every 6 hours','2026-10-24 09:20:00',3,1,3),
(4,'As directed','Twice daily','2026-10-24 09:40:00',4,8,4),
(5,'20 mg','Once daily','2026-10-24 10:20:00',5,5,1),
(6,'10 mg','Once daily','2026-10-24 10:55:00',6,4,6),
(7,'500 mg','As needed','2026-10-24 11:30:00',7,1,5),
(8,'2.5 mg nebulized','As prescribed','2026-10-24 12:10:00',8,7,1),
(9,'As directed','Once','2026-10-24 12:40:00',9,8,4),
(10,'4 mg','As needed','2026-10-24 13:20:00',10,9,8);

INSERT INTO TEST_ORDER
(test_order_id, order_time, result_status, result_value, case_id, doctor_id, test_id)
VALUES
(1,'2026-10-24 08:25:00','Completed','Abnormal rhythm detected',1,2,1),
(2,'2026-10-24 08:55:00','Completed','Mildly elevated WBC',2,5,2),
(3,'2026-10-24 09:15:00','In Progress',NULL,3,3,3),
(4,'2026-10-24 09:40:00','Completed','Distal radius fracture',4,4,4),
(5,'2026-10-24 10:20:00','Ordered',NULL,5,1,5),
(6,'2026-10-24 10:55:00','Completed','Likely allergic response',6,6,6),
(7,'2026-10-24 11:30:00','Completed','Glucose within normal range',7,5,7),
(8,'2026-10-24 12:10:00','In Progress',NULL,8,1,8),
(9,'2026-10-24 12:40:00','Completed','Superficial burn',9,4,9),
(10,'2026-10-24 13:20:00','Ordered',NULL,10,8,10);

INSERT INTO BILLING (bill_id, total_amount, payment_status, payment_mode, bill_date, case_id) VALUES
(1,3500.00,'Pending','Insurance','2026-10-24 09:00:00',1),
(2,1250.00,'Paid','UPI','2026-10-24 11:10:00',2),
(3,4200.00,'Pending','Insurance','2026-10-24 10:00:00',3),
(4,1800.00,'Paid','Card','2026-10-24 12:10:00',4),
(5,2900.00,'Partially Paid','Cash','2026-10-24 11:00:00',5),
(6,950.00,'Paid','UPI','2026-10-24 11:40:00',6),
(7,650.00,'Paid','Cash','2026-10-24 12:10:00',7),
(8,3100.00,'Pending','Insurance','2026-10-24 13:00:00',8),
(9,500.00,'Paid','Card','2026-10-24 13:10:00',9),
(10,800.00,'Pending','Other','2026-10-24 14:00:00',10);
