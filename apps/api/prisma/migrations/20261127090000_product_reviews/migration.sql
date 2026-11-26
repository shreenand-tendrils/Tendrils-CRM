-- Product reviews: requests with links/files, reviewers, decisions, versions and comments.
CREATE TYPE "ReviewStatus" AS ENUM ('IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED');
CREATE TYPE "ReviewDecision" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "dueDate" TIMESTAMP(3),
    "requesterId" TEXT NOT NULL,
    "teamIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductReview_requesterId_createdAt_idx" ON "ProductReview"("requesterId", "createdAt");
CREATE INDEX "ProductReview_status_dueDate_idx" ON "ProductReview"("status", "dueDate");
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductReviewItem" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "originalName" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductReviewItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductReviewItem_storageKey_key" ON "ProductReviewItem"("storageKey");
CREATE INDEX "ProductReviewItem_reviewId_version_idx" ON "ProductReviewItem"("reviewId", "version");
ALTER TABLE "ProductReviewItem" ADD CONSTRAINT "ProductReviewItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewItem" ADD CONSTRAINT "ProductReviewItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductReviewer" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductReviewer_pkey" PRIMARY KEY ("reviewId", "userId")
);
CREATE INDEX "ProductReviewer_userId_decision_idx" ON "ProductReviewer"("userId", "decision");
ALTER TABLE "ProductReviewer" ADD CONSTRAINT "ProductReviewer_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewer" ADD CONSTRAINT "ProductReviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductReviewComment" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductReviewComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductReviewComment_reviewId_createdAt_idx" ON "ProductReviewComment"("reviewId", "createdAt");
ALTER TABLE "ProductReviewComment" ADD CONSTRAINT "ProductReviewComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReviewComment" ADD CONSTRAINT "ProductReviewComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
