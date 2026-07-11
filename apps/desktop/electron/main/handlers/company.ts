import { ipcMain, dialog } from "electron";
import { getPrisma } from "../database";
import fs from "fs";
import path from "path";

// One-shot data fix: convert a filesystem logoPath/signaturePath into an inline
// base64 data URL so the image lives inside the DB — and therefore inside every
// backup (a path under userData was never backed up, and dies on any other
// machine). Idempotent: data: values and missing files are left alone.
export async function backfillInlineImages(): Promise<void> {
  const prisma = getPrisma();
  try {
    const company = await prisma.company.findFirst();
    if (!company) return;

    const inline = (p: string | null): string | null => {
      if (!p || p.startsWith("data:") || !fs.existsSync(p)) return null;
      const ext = path.extname(p).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
    };

    const logo = inline(company.logoPath);
    const sign = inline(company.signaturePath);
    if (!logo && !sign) return;

    await prisma.company.update({
      where: { id: company.id },
      data: {
        ...(logo ? { logoPath: logo } : {}),
        ...(sign ? { signaturePath: sign } : {}),
      },
    });
    console.log("[inlineImageBackfill] converted stored image path(s) to inline data URLs");
  } catch (e) {
    console.error("[inlineImageBackfill] failed, app continues:", e);
  }
}

export const setupCompanyHandlers = () => {
  const prisma = getPrisma();

  // Get company information
  ipcMain.handle("company:get", async () => {
    try {
      const company = await prisma.company.findFirst();
      return { success: true, data: company };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch company",
      };
    }
  });

  // Create company
  ipcMain.handle("company:create", async (_, data) => {
    try {
      const company = await prisma.company.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          taxId: data.taxId,
          logoPath: data.logoPath,
          fiscalYearStart: data.fiscalYearStart || 4,
          currency: data.currency || "USD",
          invoicePrefix: data.invoicePrefix || "INV",
          termsConditions: data.termsConditions,
          bankDetails: data.bankDetails,
          signaturePath: data.signaturePath,
        },
      });

      return { success: true, data: company };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create company",
      };
    }
  });

  // Update company
  ipcMain.handle("company:update", async (_, id, data) => {
    try {
      const company = await prisma.company.update({
        where: { id },
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          taxId: data.taxId,
          logoPath: data.logoPath,
          fiscalYearStart: data.fiscalYearStart,
          currency: data.currency,
          invoicePrefix: data.invoicePrefix,
          termsConditions: data.termsConditions,
          bankDetails: data.bankDetails,
          signaturePath: data.signaturePath,
        },
      });

      return { success: true, data: company };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update company",
      };
    }
  });

  // Upload logo
  ipcMain.handle("company:uploadLogo", async (_, filePath) => {
    try {
      // In a real implementation, you'd copy the file to app data directory
      // For now, we'll just return the path
      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to upload logo",
      };
    }
  });

  // Select and upload image
  ipcMain.handle("company:selectImage", async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const sourcePath = result.filePaths[0];

      // Return the image as an inline base64 data URL, not a copied file path.
      // Stored inline (logoPath/signaturePath), it lives inside the DB — so it
      // survives backup/restore and cross-device moves. A path under userData
      // did neither: it was the one asset the Drive backup could never carry,
      // and the shared PDF code only renders data: URIs anyway. Mirrors mobile.
      const ext = path.extname(sourcePath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const base64 = fs.readFileSync(sourcePath).toString("base64");
      return { success: true, path: `data:${mime};base64,${base64}` };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to select image",
      };
    }
  });
};
