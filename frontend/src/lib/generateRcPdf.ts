/**
 * Client-side PDF generation for a third-party vehicle registry lookup summary.
 * This is not an official RC/Form 23, government-issued document, or digital verification.
 */

import { jsPDF } from "jspdf";
import type { IndianVehicleRcRecord } from "./registry";

/**
 * Sanitize strings for jsPDF Helvetica/Courier core fonts (ASCII / WinAnsi).
 * Replaces non-ASCII symbols like Rupee (₹), bullets, and special arrows.
 */
function cleanText(input: unknown): string {
  if (input == null) return "—";
  return String(input)
    .replace(/₹/g, "Rs. ")
    .replace(/[•●]/g, "-")
    .replace(/[↗→]/g, " ")
    .replace(/[^\x20-\x7E\r\n\t]/g, " ")
    .trim();
}

export function generateRcPdf(record: IndianVehicleRcRecord, includeSensitiveDetails = false): void {
  // Export masked personal/vehicle identifiers by default, matching the UI's privacy default.
  const ownerName = includeSensitiveDetails ? record.ownerName : record.maskedOwnerName;
  const fatherName = includeSensitiveDetails ? record.fatherHusbandName : record.maskedFatherName;
  const ownerAddress = includeSensitiveDetails ? record.permanentAddress : record.maskedAddress;
  const chassisNumber = includeSensitiveDetails ? record.chassisNumber : record.maskedChassisNumber;
  const engineNumber = includeSensitiveDetails ? record.engineNumber : record.maskedEngineNumber;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 186mm

  // Colors
  const primaryNavy = [15, 23, 42]; // #0f172a
  const borderGrey = [180, 190, 205];
  const tableBg = [248, 250, 252];
  const goldAccent = [180, 83, 9];

  // 1. Outer Border & Watermark Seal
  doc.setDrawColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.setLineWidth(0.8);
  doc.rect(margin, margin, contentWidth, 273); // Main border

  doc.setDrawColor(borderGrey[0], borderGrey[1], borderGrey[2]);
  doc.setLineWidth(0.3);
  doc.rect(margin + 1.2, margin + 1.2, contentWidth - 2.4, 270.6); // Inner thin border

  let y = margin + 7;

  // 2. Official Government Header Strip
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.text("VEHICLE REGISTRY LOOKUP SUMMARY", pageWidth / 2, y, { align: "center" });
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(goldAccent[0], goldAccent[1], goldAccent[2]);
  doc.text("THIRD-PARTY PROVIDER RESPONSE • NOT GOVERNMENT-ISSUED", pageWidth / 2, y, { align: "center" });
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(70, 80, 95);
  doc.text("SOURCE: CONFIGURED VAHAN DATA PROVIDER (RAPIDAPI)", pageWidth / 2, y, { align: "center" });
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.text("UNOFFICIAL DATA EXTRACT", pageWidth / 2, y, { align: "center" });
  y += 3.8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("NOT A CERTIFICATE OF REGISTRATION", pageWidth / 2, y, { align: "center" });
  y += 5;

  // Top Divider
  doc.setDrawColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.setLineWidth(0.5);
  doc.line(margin + 3, y, margin + contentWidth - 3, y);
  y += 4;

  // 3. Registration Badge Box (HSRP Visual Frame)
  const plateBoxWidth = 84;
  const plateBoxHeight = 13;
  const plateBoxX = (pageWidth - plateBoxWidth) / 2;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.setLineWidth(0.8);
  doc.roundedRect(plateBoxX, y, plateBoxWidth, plateBoxHeight, 1.5, 1.5, "FD");

  // IND blue strip
  doc.setFillColor(30, 58, 138);
  doc.roundedRect(plateBoxX, y, 9, plateBoxHeight, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text("IND", plateBoxX + 4.5, y + 8, { align: "center" });

  // Registration Number Text
  doc.setFont("courier", "bold");
  doc.setFontSize(15);
  doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  doc.text(record.formattedPlate, plateBoxX + 47, y + 8.5, { align: "center" });

  // Neutral source status; do not imply government validation.
  doc.setFillColor(100, 116, 139);
  doc.roundedRect(margin + contentWidth - 34, y + 2, 30, 8, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(cleanText(record.rcStatus), margin + contentWidth - 19, y + 7, { align: "center" });

  y += plateBoxHeight + 5;

  // Helper function to draw Section Header
  const drawSectionHeader = (title: string, sectionY: number): number => {
    doc.setFillColor(238, 242, 246);
    doc.rect(margin + 2, sectionY, contentWidth - 4, 5.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
    doc.text(cleanText(title), margin + 4, sectionY + 4);
    return sectionY + 7;
  };

  // Helper function to draw 2-column grid row
  const drawRow2Col = (
    label1: string,
    val1: string,
    label2: string,
    val2: string,
    rowY: number,
    isShaded = false
  ): number => {
    const rowH = 5.2;
    if (isShaded) {
      doc.setFillColor(tableBg[0], tableBg[1], tableBg[2]);
      doc.rect(margin + 2, rowY, contentWidth - 4, rowH, "F");
    }
    const midX = margin + contentWidth / 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(cleanText(label1), margin + 4, rowY + 3.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
    doc.text(cleanText(val1), margin + 44, rowY + 3.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(cleanText(label2), midX + 2, rowY + 3.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
    doc.text(cleanText(val2), midX + 42, rowY + 3.8);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin + 2, rowY + rowH, margin + contentWidth - 2, rowY + rowH);

    return rowY + rowH;
  };

  // -------------------------------------------------------------
  // PART A: REGISTRATION & AUTHORITY DETAILS
  // -------------------------------------------------------------
  y = drawSectionHeader("PART A: REGISTRATION & JURISDICTION PARTICULARS", y);
  y = drawRow2Col("Registering Authority:", record.registeringAuthority, "State / Territory:", record.state, y, true);
  y = drawRow2Col("Registration Date:", record.registrationDate, "RC Status Date:", record.rcStatusDate, y);
  y = drawRow2Col("Fitness Validity:", `${record.fitnessUpto} (${record.fitnessStatus})`, "MV Tax Date:", `${record.taxUpto} (${record.taxStatus})`, y, true);
  y += 2;

  // -------------------------------------------------------------
  // PART B: REGISTERED OWNER PARTICULARS
  // -------------------------------------------------------------
  y = drawSectionHeader("PART B: REGISTERED OWNER PARTICULARS", y);
  y = drawRow2Col("Owner Name:", ownerName || "Not provided", "Owner Serial:", record.ownerSerial, y, true);
  y = drawRow2Col("Father / Husband Name:", fatherName || "Not provided", "Financier Status:", record.financingStatus, y);

  // Address spanning row
  doc.setFillColor(tableBg[0], tableBg[1], tableBg[2]);
  doc.rect(margin + 2, y, contentWidth - 4, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("Permanent Address:", margin + 4, y + 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(primaryNavy[0], primaryNavy[1], primaryNavy[2]);
  const splitAddress = doc.splitTextToSize(cleanText(ownerAddress || "Not provided"), contentWidth - 52);
  doc.text(splitAddress, margin + 44, y + 4);
  y += 10;

  if (record.hypothecationBank) {
    y = drawRow2Col("Hypothecation (provider field):", record.hypothecationBank, "RTO NOC Clearance:", "Not provided by upstream source", y, true);
  }
  y += 2;

  // -------------------------------------------------------------
  // PART C: DETAILED TECHNICAL SPECIFICATIONS
  // -------------------------------------------------------------
  y = drawSectionHeader("PART C: VEHICLE TECHNICAL & STRUCTURAL SPECIFICATIONS", y);
  y = drawRow2Col("Maker / Manufacturer:", record.maker, "Model Name:", record.model, y, true);
  y = drawRow2Col("Vehicle Class:", record.vehicleClass, "Body Type:", record.bodyType, y);
  y = drawRow2Col("Chassis Number (VIN):", chassisNumber || "Not provided", "Engine / Motor No:", engineNumber || "Not provided", y, true);
  y = drawRow2Col("Fuel Description:", record.fuelType, "Emission Standard:", record.emissionNorms, y);
  y = drawRow2Col("Cubic Capacity (cc):", record.cubicCapacity, "Seating Capacity:", record.seatingCapacity == null ? "Not provided" : `${record.seatingCapacity} (Incl. Driver)`, y, true);
  y = drawRow2Col("Unladen / Gross Wt:", `${record.unladenWeight} / ${record.grossWeight}`, "Wheelbase / Color:", `${record.wheelbase} / ${record.color}`, y);
  y += 2;

  // -------------------------------------------------------------
  // PART D: STATUTORY COMPLIANCE & VALIDITY MATRIX
  // -------------------------------------------------------------
  y = drawSectionHeader("PART D: STATUTORY COMPLIANCE, INSURANCE & PUCC VALIDITY", y);
  y = drawRow2Col("Insurance Company:", record.insuranceCompany, "Policy Number:", record.insurancePolicyNumber, y, true);
  y = drawRow2Col("Insurance Valid Upto:", `${record.insuranceUpto} (${record.insuranceStatus})`, "PUCC Certificate No:", record.puccNumber, y);
  y = drawRow2Col("PUCC Valid Upto:", `${record.puccUpto} (${record.puccStatus})`, "Blacklist / Challan:", record.challanCount == null ? record.blacklistStatus : `${record.blacklistStatus} (${record.challanCount} reported)`, y, true);
  y = drawRow2Col("FASTag Tag ID:", record.fastagId, "Issuer Bank:", record.fastagBank, y);
  y += 4;

  // -------------------------------------------------------------
  // DISCLAIMER: provider data is not an RC, Form 23, digital signature or QR verification.
  // -------------------------------------------------------------
  const footerY = y + 2;
  const textX = margin + 4;
  const disclaimerLines = [
    "NOT AN OFFICIAL REGISTRATION CERTIFICATE / FORM 23",
    "This PDF is a client-generated summary of fields returned by a third-party provider.",
    "No government digital signature, verification hash, QR code, RTO seal, challan clearance",
    "or proof of ownership was supplied or independently verified by this application.",
    "For authoritative records, use the official Parivahan portal: https://parivahan.gov.in/",
    `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(153, 27, 27);
  doc.text(disclaimerLines[0], textX, footerY + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(80, 95, 115);
  disclaimerLines.slice(1).forEach((line, index) => {
    doc.text(cleanText(line), textX, footerY + 9 + index * 4);
  });

  // Save as a lookup summary, never as an RC certificate.
  const fileName = `Vehicle_Lookup_Summary_${cleanText(record.registrationNumber)}.pdf`;
  try {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1500);
  } catch {
    doc.save(fileName);
  }
}
