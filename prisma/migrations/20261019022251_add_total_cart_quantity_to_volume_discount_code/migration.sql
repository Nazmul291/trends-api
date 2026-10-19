/*
  Warnings:

  - Added the required column `totalCartQuantity` to the `VolumeDiscountCode` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "VolumeDiscountCode" ADD COLUMN     "totalCartQuantity" INTEGER NOT NULL;
