-- Prisma 6.16.3 sends this file as one simple Query. PostgreSQL runs every
-- statement in that message inside one implicit transaction unless a COMMIT
-- separates them. The COMMIT is the separate step: NOT VALID is committed
-- before VALIDATE CONSTRAINT scans existing rows. If validation fails, the
-- NOT VALID foreign key stays in place and this migration is not recorded.
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "CallRecord" VALIDATE CONSTRAINT "CallRecord_userId_fkey";
