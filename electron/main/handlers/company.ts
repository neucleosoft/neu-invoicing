import { ipcMain, dialog, app } from "electron";
import { getPrisma } from "../database";
import { triggerSyncAfterChange } from "../sync";
import fs from "fs";
import path from "path";

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

      await triggerSyncAfterChange();
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

      await triggerSyncAfterChange();
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

      const uploadsDir = path.join(app.getPath("userData"), "uploads");

      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = path.extname(sourcePath);

      const fileName = `signature-${Date.now()}${ext}`;

      const destPath = path.join(uploadsDir, fileName);

      fs.copyFileSync(sourcePath, destPath);

      return { success: true, path: destPath };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to select image",
      };
    }
  });
};
