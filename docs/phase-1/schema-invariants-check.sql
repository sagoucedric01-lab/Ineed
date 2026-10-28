-- Vérifications des invariants du schéma brouillon (exécution : psql -v ON_ERROR_STOP=1)
-- Chaque bloc DO doit afficher "OK ..." ; une violation non détectée lève une erreur.
\set QUIET on
BEGIN;
INSERT INTO countries VALUES ('CI','Côte d''Ivoire','XOF','+225',true);
INSERT INTO cities (id,country_code,name,timezone,center,is_active)
  VALUES ('00000000-0000-0000-0000-0000000000c1','CI','Abidjan','Africa/Abidjan','SRID=4326;POINT(-4.0083 5.3600)',true);
INSERT INTO users (id,phone_e164) VALUES
  ('00000000-0000-0000-0000-00000000000a','+2250700000001'),
  ('00000000-0000-0000-0000-00000000000b','+2250700000002'),
  ('00000000-0000-0000-0000-00000000000c','+2250700000003');
INSERT INTO pro_profiles (user_id,business_name,city_id,verification_status,verified_at,last_location) VALUES
  ('00000000-0000-0000-0000-00000000000b','Plomberie Test','00000000-0000-0000-0000-0000000000c1','APPROVED',now(),'SRID=4326;POINT(-4.0100 5.3610)'),
  ('00000000-0000-0000-0000-00000000000c','Plomberie Test 2','00000000-0000-0000-0000-0000000000c1','APPROVED',now(),'SRID=4326;POINT(-3.9000 5.3000)');
INSERT INTO categories (id,slug,name,icon_key) VALUES ('00000000-0000-0000-0000-0000000000ca','plomberie','Plomberie','pipe');
INSERT INTO service_requests (id,client_id,city_id,category_id,pricing_model,mode,status,description,location,address_snapshot)
  VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000ca','QUOTE','URGENT','MATCHING','Fuite sous l''évier de la cuisine',
          'SRID=4326;POINT(-4.0083 5.3600)','{"landmark":"Près du maquis"}');
COMMIT;

-- 1. Recherche de proximité PostGIS (rayon 5 km) : seul le pro proche doit sortir
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pro_profiles p
   WHERE p.verification_status='APPROVED'
     AND ST_DWithin(p.last_location, 'SRID=4326;POINT(-4.0083 5.3600)'::geography, 5000);
  IF n <> 1 THEN RAISE EXCEPTION 'proximity: expected 1 got %', n; END IF;
  RAISE NOTICE 'OK 1 recherche de proximité';
END $$;

-- 2. Attribution unique : deux missions actives pour une même demande sont refusées
INSERT INTO missions (id,reference,request_id,client_id,pro_id,pricing_model,status) VALUES
 ('00000000-0000-0000-0000-0000000000d1','IN-TEST-1','00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','QUOTE','AWAITING_QUOTE');
DO $$ BEGIN
  BEGIN
    INSERT INTO missions (reference,request_id,client_id,pro_id,pricing_model,status) VALUES
     ('IN-TEST-2','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a',
      '00000000-0000-0000-0000-00000000000c','QUOTE','AWAITING_QUOTE');
    RAISE EXCEPTION 'double attribution accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK 2 double attribution refusée'; END;
END $$;

-- 3. Devis : total incohérent refusé au commit ; lignes immuables après soumission
DO $$ BEGIN
  BEGIN
    INSERT INTO quotes (id,mission_id,version,status,total_xof,valid_until,created_by,submitted_at)
      VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000d1',1,'DRAFT',25000,now()+interval '2 days','00000000-0000-0000-0000-00000000000b',null);
    INSERT INTO quote_lines (quote_id,kind,label,unit_price_xof) VALUES
      ('00000000-0000-0000-0000-0000000000f1','TRAVEL','Déplacement',2000),
      ('00000000-0000-0000-0000-0000000000f1','LABOR','Main-d''œuvre',15000);
    UPDATE quotes SET status='SUBMITTED' WHERE id='00000000-0000-0000-0000-0000000000f1';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'bad total accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'quote%total%' THEN RAISE NOTICE 'OK 3a total de devis incohérent refusé'; ELSE RAISE; END IF;
  END;
END $$;
INSERT INTO quotes (id,mission_id,version,status,total_xof,valid_until,created_by)
  VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000d1',1,'DRAFT',17000,now()+interval '2 days','00000000-0000-0000-0000-00000000000b');
INSERT INTO quote_lines (quote_id,kind,label,unit_price_xof) VALUES
  ('00000000-0000-0000-0000-0000000000f1','TRAVEL','Déplacement',2000),
  ('00000000-0000-0000-0000-0000000000f1','LABOR','Main-d''œuvre',15000);
UPDATE quotes SET status='SUBMITTED', submitted_at=now() WHERE id='00000000-0000-0000-0000-0000000000f1';
DO $$ BEGIN
  BEGIN
    UPDATE quote_lines SET unit_price_xof=30000 WHERE quote_id='00000000-0000-0000-0000-0000000000f1' AND kind='LABOR';
    RAISE EXCEPTION 'line mutation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%immutable%' THEN RAISE NOTICE 'OK 3b devis soumis immuable'; ELSE RAISE; END IF;
  END;
END $$;

-- 4. Paiement : un seul succès par objet ; plafond de remboursement
INSERT INTO payments (id,mission_id,quote_id,payer_id,purpose,gross_amount_xof,amount_xof,provider,is_sandbox,merchant_reference,provider_txn_id,status,idempotency_key,confirmed_at)
 VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f1',
         '00000000-0000-0000-0000-00000000000a','WORK',17000,17000,'sandbox',true,'PAY-1','SBX-1','SUCCEEDED','idem-key-001',now());
DO $$ BEGIN
  BEGIN
    INSERT INTO payments (mission_id,quote_id,payer_id,purpose,gross_amount_xof,amount_xof,provider,is_sandbox,merchant_reference,provider_txn_id,status,idempotency_key,confirmed_at)
     VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f1',
             '00000000-0000-0000-0000-00000000000a','WORK',17000,17000,'sandbox',true,'PAY-2','SBX-2','SUCCEEDED','idem-key-002',now());
    RAISE EXCEPTION 'double success accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK 4a double paiement réussi refusé'; END;
  BEGIN
    UPDATE payments SET status='SUCCEEDED', confirmed_at=NULL WHERE id='00000000-0000-0000-0000-0000000000b1';
    RAISE EXCEPTION 'success without confirmation accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK 4b succès sans confirmation serveur refusé'; END;
END $$;
INSERT INTO refunds (payment_id,amount_xof,reason,idempotency_key) VALUES ('00000000-0000-0000-0000-0000000000b1',10000,'Partiel','ref-1');
DO $$ BEGIN
  BEGIN
    INSERT INTO refunds (payment_id,amount_xof,reason,idempotency_key) VALUES ('00000000-0000-0000-0000-0000000000b1',8000,'Trop','ref-2');
    RAISE EXCEPTION 'refund cap not enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'refund cap%' THEN RAISE NOTICE 'OK 4c plafond de remboursement'; ELSE RAISE; END IF;
  END;
END $$;

-- 5. Grand livre : transaction déséquilibrée refusée, écritures non modifiables
DO $$ DECLARE t uuid := gen_random_uuid(); BEGIN
  BEGIN
    INSERT INTO ledger_transactions (id,kind) VALUES (t,'ADJUSTMENT');
    INSERT INTO ledger_entries (transaction_id,account,amount_xof) VALUES (t,'CLIENT_FUNDS_IN',100);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'unbalanced accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%unbalanced%' THEN RAISE NOTICE 'OK 5 écriture déséquilibrée refusée'; ELSE RAISE; END IF;
  END;
END $$;

-- 6. Avis : refusé tant que la mission n'est pas clôturée
DO $$ BEGIN
  BEGIN
    INSERT INTO reviews (mission_id,client_id,pro_id,rating) VALUES
     ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b',5);
    RAISE EXCEPTION 'review on open mission accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'review not allowed%' THEN RAISE NOTICE 'OK 6 avis sur mission non clôturée refusé'; ELSE RAISE; END IF;
  END;
END $$;

-- 7. Journal d'audit en ajout seul
INSERT INTO audit_logs (action,entity_type) VALUES ('test','test');
DO $$ BEGIN
  BEGIN DELETE FROM audit_logs; RAISE EXCEPTION 'audit delete accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE 'OK 7 journal d''audit non modifiable'; ELSE RAISE; END IF;
  END;
END $$;
