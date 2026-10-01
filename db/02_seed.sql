-- Synthetic CRM seed data.
-- All dates are relative to NOW() so the scenarios behave the same whenever the stack is started.
-- Each customer is built around one policy scenario (see README "Test scenarios").

INSERT INTO customers (id, name, email, tier, created_at, risk_flag, notes) VALUES
('C001', 'Ada Okafor',     'ada.okafor@example.com',     'standard', NOW() - INTERVAL '400 days', FALSE, NULL),
('C002', 'Ben Carter',     'ben.carter@example.com',     'standard', NOW() - INTERVAL '300 days', FALSE, NULL),
('C003', 'Chloe Nguyen',   'chloe.nguyen@example.com',   'gold',     NOW() - INTERVAL '700 days', FALSE, NULL),
('C004', 'David Mensah',   'david.mensah@example.com',   'gold',     NOW() - INTERVAL '900 days', FALSE, NULL),
('C005', 'Emeka Eze',      'emeka.eze@example.com',      'standard', NOW() - INTERVAL '150 days', FALSE, NULL),
('C006', 'Fatima Bello',   'fatima.bello@example.com',   'standard', NOW() - INTERVAL '200 days', TRUE,  'Flagged by risk team: high refund frequency.'),
('C007', 'George Adams',   'george.adams@example.com',   'standard', NOW() - INTERVAL '30 days',  FALSE, NULL),
('C008', 'Hannah Lee',     'hannah.lee@example.com',     'gold',     NOW() - INTERVAL '500 days', FALSE, NULL),
('C009', 'Ifeoma Nwosu',   'ifeoma.nwosu@example.com',   'standard', NOW() - INTERVAL '90 days',  FALSE, NULL),
('C010', 'James Okoro',    'james.okoro@example.com',    'standard', NOW() - INTERVAL '250 days', FALSE, NULL),
('C011', 'Kemi Adeyemi',   'kemi.adeyemi@example.com',   'platinum', NOW() - INTERVAL '1200 days', FALSE, NULL),
('C012', 'Liam Brown',     'liam.brown@example.com',     'standard', NOW() - INTERVAL '60 days',  FALSE, NULL),
('C013', 'Maria Garcia',   'maria.garcia@example.com',   'platinum', NOW() - INTERVAL '1500 days', FALSE, NULL),
('C014', 'Nnamdi Obi',     'nnamdi.obi@example.com',     'standard', NOW() - INTERVAL '45 days',  FALSE, NULL),
('C015', 'Olivia Smith',   'olivia.smith@example.com',   'gold',     NOW() - INTERVAL '800 days', FALSE, NULL);

-- Credentials are not seeded: the one-off `provision` service issues a unique password per account.
INSERT INTO agents (id, email, name) VALUES
('A001', 'alex.morgan@refunddesk.test', 'Alex Morgan'),
('A002', 'sam.lee@refunddesk.test',     'Sam Lee');

INSERT INTO orders (id, customer_id, placed_at, status, expected_delivery, delivered_at, signature_on_delivery, total) VALUES
-- C001 happy path: damaged item, recent
('ORD-1001', 'C001', NOW() - INTERVAL '9 days',   'delivered', NOW() - INTERVAL '5 days',   NOW() - INTERVAL '5 days',   FALSE, 89.99),
('ORD-1002', 'C001', NOW() - INTERVAL '125 days', 'delivered', NOW() - INTERVAL '120 days', NOW() - INTERVAL '120 days', FALSE, 19.99),
-- C002 outside refund window
('ORD-1003', 'C002', NOW() - INTERVAL '66 days',  'delivered', NOW() - INTERVAL '62 days',  NOW() - INTERVAL '62 days',  FALSE, 149.00),
-- C003 final sale item
('ORD-1004', 'C003', NOW() - INTERVAL '8 days',   'delivered', NOW() - INTERVAL '4 days',   NOW() - INTERVAL '4 days',   FALSE, 120.00),
-- C004 high value (> $500)
('ORD-1005', 'C004', NOW() - INTERVAL '7 days',   'delivered', NOW() - INTERVAL '3 days',   NOW() - INTERVAL '3 days',   TRUE,  1299.00),
-- C005 wrong item received
('ORD-1006', 'C005', NOW() - INTERVAL '14 days',  'delivered', NOW() - INTERVAL '10 days',  NOW() - INTERVAL '10 days',  FALSE, 140.00),
-- C006 risk-flagged serial refunder
('ORD-1007', 'C006', NOW() - INTERVAL '10 days',  'delivered', NOW() - INTERVAL '6 days',   NOW() - INTERVAL '6 days',   FALSE, 249.00),
('ORD-1008', 'C006', NOW() - INTERVAL '80 days',  'delivered', NOW() - INTERVAL '76 days',  NOW() - INTERVAL '76 days',  FALSE, 65.00),
('ORD-1009', 'C006', NOW() - INTERVAL '60 days',  'delivered', NOW() - INTERVAL '56 days',  NOW() - INTERVAL '56 days',  FALSE, 110.00),
('ORD-1010', 'C006', NOW() - INTERVAL '40 days',  'delivered', NOW() - INTERVAL '36 days',  NOW() - INTERVAL '36 days',  FALSE, 89.00),
('ORD-1011', 'C006', NOW() - INTERVAL '25 days',  'delivered', NOW() - INTERVAL '21 days',  NOW() - INTERVAL '21 days',  FALSE, 54.00),
-- C007 not shipped yet
('ORD-1012', 'C007', NOW() - INTERVAL '1 day',    'processing', NOW() + INTERVAL '4 days',  NULL,                        FALSE, 59.00),
-- C008 shipped but overdue
('ORD-1013', 'C008', NOW() - INTERVAL '20 days',  'shipped',   NOW() - INTERVAL '8 days',   NULL,                        FALSE, 79.00),
-- C009 change of mind, inside 14 days
('ORD-1014', 'C009', NOW() - INTERVAL '10 days',  'delivered', NOW() - INTERVAL '7 days',   NOW() - INTERVAL '7 days',   FALSE, 45.00),
-- C010 change of mind, outside 14 days (but inside 30 for defects)
('ORD-1015', 'C010', NOW() - INTERVAL '24 days',  'delivered', NOW() - INTERVAL '20 days',  NOW() - INTERVAL '20 days',  FALSE, 99.00),
-- C011 already refunded
('ORD-1016', 'C011', NOW() - INTERVAL '13 days',  'delivered', NOW() - INTERVAL '9 days',   NOW() - INTERVAL '9 days',   FALSE, 89.00),
-- C012 mixed order: normal item + final-sale item
('ORD-1017', 'C012', NOW() - INTERVAL '9 days',   'delivered', NOW() - INTERVAL '5 days',   NOW() - INTERVAL '5 days',   FALSE, 85.00),
-- C013 two items, total just over $500
('ORD-1018', 'C013', NOW() - INTERVAL '6 days',   'delivered', NOW() - INTERVAL '2 days',   NOW() - INTERVAL '2 days',   FALSE, 515.00),
-- C014 "not received" but signed for
('ORD-1019', 'C014', NOW() - INTERVAL '8 days',   'delivered', NOW() - INTERVAL '4 days',   NOW() - INTERVAL '4 days',   TRUE,  499.00),
-- C015 high-value change of mind + a cancelled order
('ORD-1020', 'C015', NOW() - INTERVAL '12 days',  'delivered', NOW() - INTERVAL '8 days',   NOW() - INTERVAL '8 days',   FALSE, 529.00),
('ORD-1021', 'C015', NOW() - INTERVAL '40 days',  'cancelled', NULL,                        NULL,                        FALSE, 35.00);

INSERT INTO order_items (id, order_id, sku, name, category, unit_price, quantity, final_sale, legacy_refunded) VALUES
('IT-1001', 'ORD-1001', 'AUD-HP-220', 'Wireless Headphones',          'electronics', 89.99,  1, FALSE, FALSE),
('IT-1002', 'ORD-1002', 'ACC-PC-011', 'Phone Case',                   'accessories', 19.99,  1, FALSE, FALSE),
('IT-1003', 'ORD-1003', 'KIT-CM-400', 'Drip Coffee Maker',            'kitchen',     149.00, 1, FALSE, FALSE),
('IT-1004', 'ORD-1004', 'APP-DR-SLK', 'Silk Evening Dress',           'apparel',     120.00, 1, TRUE,  FALSE),
('IT-1005', 'ORD-1005', 'CMP-LT-14P', '14" Laptop Pro',               'electronics', 1299.00,1, FALSE, FALSE),
('IT-1006', 'ORD-1006', 'SHO-RN-42B', 'Running Sneakers (Blue, EU 42)','footwear',   140.00, 1, FALSE, FALSE),
('IT-1007', 'ORD-1007', 'WRB-SW-300', 'Smart Watch',                  'electronics', 249.00, 1, FALSE, FALSE),
('IT-1008', 'ORD-1008', 'APP-JK-DNM', 'Denim Jacket',                 'apparel',     65.00,  1, FALSE, TRUE),
('IT-1009', 'ORD-1009', 'AUD-EB-100', 'Wireless Earbuds',             'electronics', 110.00, 1, FALSE, TRUE),
('IT-1010', 'ORD-1010', 'KIT-AF-200', 'Air Fryer',                    'kitchen',     89.00,  1, FALSE, TRUE),
('IT-1011', 'ORD-1011', 'HOM-LP-050', 'Table Lamp',                   'home',        54.00,  1, FALSE, TRUE),
('IT-1012', 'ORD-1012', 'HOM-DL-010', 'LED Desk Lamp',                'home',        59.00,  1, FALSE, FALSE),
('IT-1013', 'ORD-1013', 'BAG-BP-030', 'Travel Backpack',              'bags',        79.00,  1, FALSE, FALSE),
('IT-1014', 'ORD-1014', 'FIT-YM-006', 'Yoga Mat',                     'fitness',     45.00,  1, FALSE, FALSE),
('IT-1015', 'ORD-1015', 'AUD-SP-BT2', 'Bluetooth Speaker',            'electronics', 99.00,  1, FALSE, FALSE),
('IT-1016', 'ORD-1016', 'KIT-BL-900', 'High-Speed Blender',           'kitchen',     89.00,  1, FALSE, TRUE),
('IT-1017', 'ORD-1017', 'KIT-MG-SET', 'Ceramic Mug Set (4)',          'kitchen',     60.00,  1, FALSE, FALSE),
('IT-1018', 'ORD-1017', 'HOM-PL-CLR', 'Clearance Throw Pillow',       'home',        25.00,  1, TRUE,  FALSE),
('IT-1019', 'ORD-1018', 'KIT-EM-PRO', 'Espresso Machine',             'kitchen',     480.00, 1, FALSE, FALSE),
('IT-1020', 'ORD-1018', 'KIT-MF-010', 'Milk Frother',                 'kitchen',     35.00,  1, FALSE, FALSE),
('IT-1021', 'ORD-1019', 'GAM-CN-X5',  'Gaming Console',               'electronics', 499.00, 1, FALSE, FALSE),
('IT-1022', 'ORD-1020', 'FUR-OC-ERG', 'Ergonomic Office Chair',       'furniture',   529.00, 1, FALSE, FALSE),
('IT-1023', 'ORD-1021', 'ACC-CB-USB', 'USB-C Cable (3-pack)',         'accessories', 35.00,  1, FALSE, FALSE);

INSERT INTO past_refunds (customer_id, order_id, amount, reason, refunded_at) VALUES
('C006', 'ORD-1008', 65.00,  'item not as described', NOW() - INTERVAL '70 days'),
('C006', 'ORD-1009', 110.00, 'damaged on arrival',    NOW() - INTERVAL '50 days'),
('C006', 'ORD-1010', 89.00,  'damaged on arrival',    NOW() - INTERVAL '30 days'),
('C006', 'ORD-1011', 54.00,  'changed mind',          NOW() - INTERVAL '15 days'),
('C011', 'ORD-1016', 89.00,  'damaged on arrival',    NOW() - INTERVAL '3 days');
