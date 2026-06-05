import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ==========================================
// 1. LASER CUSTOMER CONTROLLERS
// ==========================================

export const createCustomer = async (req: Request, res: Response) => {
  try {
    const { name, email, phoneNumber, address, city, state, zipCode } =
      req.body;

    const existing = await prisma.laserCustomer.findUnique({
      where: { phoneNumber },
    });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Customer with this phone number already exists" });
    }

    const customer = await prisma.laserCustomer.create({
      data: { name, email, phoneNumber, address, city, state, zipCode },
    });
    return res.json(customer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const { id, phone } = req.query;

    if (id) {
      const customer = await prisma.laserCustomer.findUnique({
        where: { id: String(id) },
        include: {
          packages: {
            include: {
              package: true,
            },
          },
          visits: true,
        },
      });
      return res.json(customer);
    }

    if (phone) {
      const customer = await prisma.laserCustomer.findUnique({
        where: { phoneNumber: String(phone) },
        include: {
          packages: {
            include: {
              package: true,
            },
          },
          visits: true,
        },
      });
      return res.json(customer);
    }

    // ====== FIX THIS BLOCK ======
    // Include relations here so that your directory list loads with all balances ready
    const customers = await prisma.laserCustomer.findMany({
      orderBy: { name: "asc" },
      include: {
        packages: {
          include: {
            package: true, // Pulls the package setup details (like template names)
          },
        },
        visits: true,
      },
    });

    return res.json(customers);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// 2. PACKAGE CONFIGURATION CONTROLLERS
// ==========================================

export const createPackage = async (req: Request, res: Response) => {
  try {
    const { name, description, price, credit } = req.body;

    // Strict Case-Insensitive Duplicate Name Check
    const existingPackage = await prisma.package.findFirst({
      where: {
        name: {
          equals: name.trim(),
          mode: "insensitive", // Prevents "Small Area" vs "small area" duplicates
        },
      },
    });

    if (existingPackage) {
      return res.status(400).json({
        message: `A package template named "${name}" already exists in the system.`,
      });
    }

    const newPackage = await prisma.package.create({
      data: {
        name: name.trim(),
        description,
        price: Number(price),
        credit: Number(credit),
        isActive: true,
      },
    });

    return res.json(newPackage);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// 2. ADD STRATEGIC BLOCKING DELETION ENDPOINT
export const deletePackage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if any client has already purchased this template instance
    const activePurchasesCount = await prisma.laserCustomerPackage.count({
      where: { packageId: id },
    });

    if (activePurchasesCount > 0) {
      return res.status(400).json({
        message:
          "Cannot delete package template: This bundle has active purchase histories or credit ledgers allocated to customers.",
      });
    }

    // Safe to delete if the ledger count is zero
    await prisma.package.delete({
      where: { id },
    });

    return res.json({
      message: "Package template successfully removed from system definitions.",
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getPackages = async (req: Request, res: Response) => {
  try {
    const pkgs = await prisma.package.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(pkgs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// 3. CUSTOMER PACKAGE PURCHASE CONTROLLERS
// ==========================================

export const purchasePackage = async (req: Request, res: Response) => {
  try {
    const { customerId, packageId, paymentMethod } = req.body;
    const staffId = (req as any).user?.userId; // Parsed from auth middleware token signature

    // 1. Strict Validation Safeguards
    if (!paymentMethod) {
      return res.status(400).json({
        message:
          "Missing parameters: paymentMethod is required (e.g., CASH, ZELLE, CASH_APP, PAYPAL).",
      });
    }

    if (!staffId) {
      return res.status(401).json({
        message:
          "Authentication error: Unable to identify the operating staff member completing this sale.",
      });
    }

    // 2. Locate base template package settings
    const basePackage = await prisma.package.findUnique({
      where: { id: packageId },
    });

    if (!basePackage) {
      return res
        .status(404)
        .json({ message: "Package template setup not found" });
    }

    // 3. Create the ledger record instance
    const purchasedInstance = await prisma.laserCustomerPackage.create({
      data: {
        customerId,
        packageId,
        totalCredits: basePackage.credit,
        remainingCredits: basePackage.credit,
        status: "ACTIVE",
        paymentMethod: paymentMethod, // Strictly injected from client payload
        soldById: staffId, // Strictly locked to the active user session ID
      },
      include: {
        package: true,
        customer: true,
      },
    });

    return res.json(purchasedInstance);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getCustomerPackages = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.query;

    if (customerId) {
      const records = await prisma.laserCustomerPackage.findMany({
        where: { customerId: String(customerId) },
        include: { package: true },
        orderBy: { purchaseDate: "desc" },
      });
      return res.json(records);
    }

    const allPurchases = await prisma.laserCustomerPackage.findMany({
      include: { customer: true, package: true },
      orderBy: { purchaseDate: "desc" },
    });
    return res.json(allPurchases);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ==========================================
// 4. COMPREHENSIVE LASER VISIT CONTROLLERS
// ==========================================

export const createLaserVisit = async (req: Request, res: Response) => {
  try {
    const { customerId, customerPackageId, ...payload } = req.body;

    // Direct translation logic for incoming Primitive Array elements to flat storage
    const arrayProofPhotos = Array.isArray(
      payload.array_proof_of_original_photo,
    )
      ? JSON.stringify(payload.array_proof_of_original_photo)
      : "";
    const oldTattooStr = Array.isArray(payload.old_tattoo)
      ? JSON.stringify(payload.old_tattoo)
      : "";
    const skinReactionStr = Array.isArray(payload.skin_reaction_protection)
      ? JSON.stringify(payload.skin_reaction_protection)
      : "";

    // Flat parsing configuration details for incoming City Structures
    const cityName = payload.city?.name || "";
    const cityCountryCode = payload.city?.countryCode || "";
    const cityStateCode = payload.city?.stateCode || "";
    const cityLatitude = payload.city?.latitude || "";
    const cityLongitude = payload.city?.longitude || "";

    // Create the visit record data block configuration mappings
    const visitData: any = {
      customerId,
      uuid: payload.uuid || "",
      status: payload.status || "In-progress",
      completed: payload.completed ?? false,
      submittedAt: payload.submittedAt || "",
      dateOfService: payload.dateOfService || "",
      artistName: payload.artist_name || "",
      name: payload.name || "",
      dob: payload.dob || "",
      age: payload.age ? parseInt(payload.age) : null,
      gender: payload.gender || "",
      occupation: payload.occupation || "",
      homeAddress: payload.home_address || "",
      licenseNumber: payload.license_number || "",
      country: payload.country || "",
      state: payload.state || "",
      zipCode: payload.zip_code || "",
      phone: payload.phone || "",
      email: payload.email || "",
      cityName,
      cityCountryCode,
      cityStateCode,
      cityLatitude,
      cityLongitude,
      emergencyContactName: payload.emergency_contact_name || "",
      emergencyContactPhone: payload.emergency_contact_phone || "",
      howDidYouHearAboutUs: payload.how_did_you_hear_about_us || "",
      referredBy: payload.referred_by || "",
      photoId: payload.photo_id || "",
      proofUrl: payload.proof_url || "",
      signatureUrl: payload.signatureUrl || "",
      specialistSignature: payload.specialist_signature || "",
      bodyDrawing: payload.body_drawing || "",
      arrayProofOfOriginalPhoto: arrayProofPhotos,
      oldTattoo: oldTattooStr,
      isItHomemade: payload.is_it_homemade || "",
      shortDescription: payload.short_description || "",
      tattooLocation: payload.tattoo_location || "",
      tattooLocations: payload.tattoo_locations || "",
      tattooSizeCategory: payload.tattoo_size_category || "",
      tattooIssueCosmetic: payload.tattoo_issue_cosmetic || "",
      treatmentNumber: payload.treatment_number || "",
      wavelength: payload.wavelength || "",
      fluence: payload.fluence || "",
      tipSize: payload.tip_size || "",
      treatmentArea: payload.treatment_area || "",
      goodCandidate: payload.good_candidate || "",
      underPhysician: payload.under_physician || "",
      physicianCare: payload.physician_care || "",
      physicianReason: payload.physician_reason || "",
      underDermatologist: payload.under_dermatologist || "",
      dermatologistCare: payload.dermatologist_care || "",
      dermatologistReason: payload.dermatologist_reason || "",
      medicalConditions: payload.medical_conditions || "",
      otherHealthProblems: payload.other_health_problems || "",
      abnormalPigmentation: payload.abnormal_pigmentation || "",
      abnormalScarring: payload.abnormal_scarring || "",
      adverseReactions: payload.adverse_reactions || "",
      allergies: payload.allergies || "",
      allergicReactions: payload.allergic_reactions || "",
      laserReaction: payload.laser_reaction || "",
      treatmentReaction: payload.treatment_reaction || "",
      lingeringSigns: payload.lingering_signs || "",
      oralMedications: payload.oral_medications || "",
      topicalMedications: payload.topical_medications || "",
      topicalOtherList: payload.topical_other_list || "",
      photosensitivityMeds: payload.photosensitivity_meds || "",
      takenAccutane: payload.taken_accutane || "",
      accutaneLastUsed: payload.accutane_last_used || "",
      skinType: payload.skin_type || "",
      skinReactionProtection: skinReactionStr,
      sunburn: payload.sunburn || "",
      raisedScars: payload.raised_scars || "",
      pigmentationMarks: payload.pigmentation_marks || "",
      pigmentationDescription: payload.pigmentation_description || "",
      pregnant: payload.pregnant || "",
      breastfeeding: payload.breastfeeding || "",
      healingNotes: payload.healing_notes || "",
      aftercareGiven: payload.aftercare_given || "",
      frequency: payload.frequency || "",
      nextTxIn: payload.next_tx_in || "",
      feeCharged: payload.fee_charged || "",
      amountPaid: payload.amount_paid || "",
      balanceOwed: payload.balance_owed || "",
      priceGuaranteedRemoval: payload.price_guaranteed_removal || "",
      pricePerTreatment: payload.price_per_treatment || "",
      pricePackage3: payload.price_package_3 || "",
      pricePackage5: payload.price_package_5 || "",
      authorizeName: payload.authorize_name || "",
      clinicName: payload.clinic_name || "Hyper Laser",
      releaseTo: payload.release_to || "Hyper Laser",
      clientDate: payload.client_date || "",
      specialistName: payload.specialist_name || "",
      specialistDate: payload.specialist_date || "",
    };

    // If an active package was used to satisfy payment, execute inside a database transaction
    if (customerPackageId && payload.completed === true) {
      const targetPackage = await prisma.laserCustomerPackage.findUnique({
        where: { id: customerPackageId },
      });

      if (!targetPackage || targetPackage.remainingCredits <= 0) {
        return res
          .status(400)
          .json({ message: "Invalid package or no credits available" });
      }

      const [newVisit] = await prisma.$transaction([
        prisma.laserVisit.create({ data: visitData }),
        prisma.laserCustomerPackage.update({
          where: { id: customerPackageId },
          data: {
            remainingCredits: { decrement: 1 },
            status:
              targetPackage.remainingCredits - 1 === 0 ? "COMPLETED" : "ACTIVE",
          },
        }),
        prisma.laserVisitPackageUsage.create({
          data: {
            visitId: req.body.visitId,
            customerPackageId: req.body.customerPackageId,
            creditsDeducted: req.body.creditsDeducted || 1,
            artistName: req.body.artistName, // Receives direct text strings like "Zoe"
          },
        }),
      ]);

      // Connect junction tracking to newly instantiated id explicitly
      await prisma.laserVisitPackageUsage.updateMany({
        where: { visitId: "", customerPackageId },
        data: { visitId: newVisit.id },
      });

      return res.json(newVisit);
    }

    // Standard baseline save option if not leveraging immediate package burning properties
    const normalVisit = await prisma.laserVisit.create({ data: visitData });
    return res.json(normalVisit);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getLaserVisits = async (req: Request, res: Response) => {
  try {
    const { id, customerId } = req.query;

    if (id) {
      const visit = await prisma.laserVisit.findUnique({
        where: { id: String(id) },
        include: { customer: true, packageUsages: true },
      });
      return res.json(visit);
    }

    if (customerId) {
      const visits = await prisma.laserVisit.findMany({
        where: { customerId: String(customerId) },
        orderBy: { createdAt: "desc" },
      });
      return res.json(visits);
    }

    const allVisits = await prisma.laserVisit.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json(allVisits);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateLaserVisit = async (req: Request, res: Response) => {
  try {
    const { id } = req.query; // Sourcing targeted tracking ID safely from your query definitions
    if (!id)
      return res.status(400).json({ message: "Missing id query parameter" });

    const payload = req.body;

    // Account for structural formatting modifications if updates impact primitive text layouts
    if (
      payload.array_proof_of_original_photo &&
      Array.isArray(payload.array_proof_of_original_photo)
    ) {
      payload.arrayProofOfOriginalPhoto = JSON.stringify(
        payload.array_proof_of_original_photo,
      );
    }
    if (payload.old_tattoo && Array.isArray(payload.old_tattoo)) {
      payload.oldTattoo = JSON.stringify(payload.old_tattoo);
    }
    if (
      payload.skin_reaction_protection &&
      Array.isArray(payload.skin_reaction_protection)
    ) {
      payload.skinReactionProtection = JSON.stringify(
        payload.skin_reaction_protection,
      );
    }

    const updatedVisit = await prisma.laserVisit.update({
      where: { id: String(id) },
      data: payload,
    });

    return res.json(updatedVisit);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteLaserVisit = async (req: Request, res: Response) => {
  try {
    const { id } = req.query; // Sourcing targeted tracking ID safely from your query definitions
    if (!id)
      return res.status(400).json({ message: "Missing id query parameter" });

    // Clean out junction links first to ensure clean row separation
    await prisma.laserVisitPackageUsage.deleteMany({
      where: { visitId: String(id) },
    });

    await prisma.laserVisit.delete({
      where: { id: String(id) },
    });

    return res.json({
      success: true,
      message: "Visit records wiped out successfully.",
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getOneHundredLatestHistoryOfPurchase = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Fetch the 100 latest package records ordered by creation date
    // Replace the findMany query block inside your controller with this:
    const purchaseLogs = await prisma.laserCustomerPackage.findMany({
      take: 100,
      orderBy: {
        purchaseDate: "desc", // Fix: Changed from createdAt to purchaseDate
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            email: true,
          },
        },
        package: {
          select: {
            id: true,
            name: true,
            price: true,
            credit: true,
          },
        },
      },
    });

    // 2. Optimization: Collect unique staff IDs from logs to map names cleanly
    // (Bypasses creating complex hard relations if User table sits inside an unlinked schema block)
    const uniqueStaffIds = Array.from(
      new Set(purchaseLogs.map((log) => log.soldById).filter(Boolean)),
    ) as string[];

    // 3. Query the User database profiles matching those specific staff IDs
    const staffProfiles = await prisma.user.findMany({
      where: {
        id: { in: uniqueStaffIds },
      },
      select: {
        id: true,
        name: true,
        role: true,
      },
    });

    // Convert to a quick-lookup key-value map: { [staffId]: staffName }
    const staffMap = staffProfiles.reduce(
      (acc, user) => {
        acc[user.id] = user.name;
        return acc;
      },
      {} as Record<string, string>,
    );

    // 4. Transform payload to attach the explicitly resolved staff member's name
    const enrichedHistory = purchaseLogs.map((log) => ({
      id: log.id,
      customerId: log.customerId,
      customerName: log.customer?.name || "Unknown Customer",
      customerPhone: log.customer?.phoneNumber || "N/A",
      packageName: log.package?.name || "Custom/Deleted Package",
      pricePaid: log.package?.price || 0,
      totalCredits: log.totalCredits,
      remainingCredits: log.remainingCredits,
      status: log.status,
      paymentMethod: log.paymentMethod,
      purchaseDate: log.purchaseDate || log.createdAt,
      soldById: log.soldById,
      soldByName: staffMap[log.soldById] || "System Engine", // Resolves staff name natively
    }));

    return res.json(enrichedHistory);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Helper function to prevent Base64 data strings from bloating the database
const filterBase64 = (val: any): string => {
  if (typeof val === "string" && val.startsWith("data:image/")) {
    return "";
  }
  return typeof val === "string" ? val.trim() : "";
};

export const syncLaserVisitFromApp = async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    // Guard: Ensure phone number exists and is not an empty string after trimming
    if (!payload.phone || String(payload.phone).trim() === "") {
      return res.status(400).json({
        message: "Phone number is explicitly required to sync visit data.",
      });
    }

    const targetPhone = String(payload.phone).trim();
    const targetEmail = payload.email?.trim().toLowerCase() || "";
    const targetName = payload.name?.trim() || "Walk-In Client";

    // Standardize UUID/Fallback tracking key
    const clientUuid = payload.uuid
      ? String(payload.uuid)
      : `fallback-${targetPhone.replace(/\D/g, "")}-${payload.dateOfService?.replace(/\D/g, "") || Date.now()}`;

    // Flatten locations/objects sent from the mobile payload structure
    const resolvedCountry =
      typeof payload.country === "object" && payload.country !== null
        ? String(payload.country.name || "")
        : String(payload.country || "");

    const resolvedState =
      typeof payload.state === "object" && payload.state !== null
        ? String(payload.state.name || "")
        : String(payload.state || "");

    const resolvedCityName =
      typeof payload.city === "object" && payload.city !== null
        ? String(payload.city.name || "")
        : String(payload.cityName || payload.city || "");

    const serializeArray = (val: any): string => {
      if (Array.isArray(val))
        return val
          .filter((item) => !String(item).startsWith("data:image/"))
          .join(", ");
      return filterBase64(val);
    };

    // ====== CONSOLIDATING MEDICAL SCREENING EXPOSURE HISTORY ======
    const aggregatedMedicalConditions = [
      payload.medicalConditions || payload.medical_conditions
        ? `Conditions: ${payload.medicalConditions || payload.medical_conditions}`
        : "",
      payload.allergies ? `Has Allergies: ${payload.allergies}` : "",
      payload.allergic_reactions || payload.allergic_reactions
        ? `Allergic Reactions: ${payload.allergic_reactions}`
        : "",
      payload.oral_medications ? `Oral Meds: ${payload.oral_medications}` : "",
      payload.photosensitivity_meds
        ? `Photosensitivity Meds: ${payload.photosensitivity_meds}`
        : "",
      payload.pregnant ? `Pregnant: ${payload.pregnant}` : "",
      payload.taken_accutane || payload.taken_accutane
        ? `Taken Accutane: ${payload.taken_accutane || payload.taken_accutane} ${payload.accutane_last_used || ""}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const aggregatedHealthProblemsAndAnamnesis = [
      payload.otherHealthProblems || payload.other_health_problems
        ? `Other Issues: ${payload.otherHealthProblems || payload.other_health_problems}`
        : "",
      payload.abnormal_pigmentation
        ? `Abnormal Pigmentation: ${payload.abnormal_pigmentation} ${payload.pigmentation_description || ""}`
        : "",
      payload.pigmentation_marks
        ? `Pigmentation Marks: ${payload.pigmentation_marks}`
        : "",
      payload.abnormal_scarring
        ? `Abnormal Scarring: ${payload.abnormal_scarring}`
        : "",
      payload.raised_scars ? `Raised Scars: ${payload.raised_scars}` : "",
      payload.sunburn ? `Sunburn: ${payload.sunburn}` : "",
      payload.under_dermatologist
        ? `Under Dermatologist: ${payload.under_dermatologist} ${payload.dermatologist_reason || ""}`
        : "",
      payload.under_physician
        ? `Under Physician: ${payload.under_physician} ${payload.physician_reason || ""}`
        : "",
      payload.adverse_reactions
        ? `Past Adverse Reactions: ${payload.adverse_reactions}`
        : "",
      payload.laser_reaction ? `Laser Reaction: ${payload.laser_reaction}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const aggregatedTreatmentMetadataNotes = [
      payload.healingNotes || payload.healing_notes || "",
      payload.frequency ? `Frequency: ${payload.frequency}` : "",
      payload.next_tx_in || payload.nextTxIn
        ? `Next Tx In: ${payload.next_tx_in || payload.nextTxIn}`
        : "",
      payload.treatment_reaction
        ? `Reaction: ${payload.treatment_reaction}`
        : "",
      payload.lingering_signs
        ? `Lingering Signs: ${payload.lingering_signs}`
        : "",
      payload.skin_reaction_protection
        ? `Skin Class: ${serializeArray(payload.skin_reaction_protection)}`
        : "",
      payload.price_per_treatment || payload.pricePerTreatment
        ? `Per Tx Base Price: ${payload.price_per_treatment || payload.pricePerTreatment}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await prisma.$transaction(async (tx) => {
      // Look for a historical match by payload key uuid
      const existingVisit = await tx.laserVisit.findFirst({
        where: { uuid: clientUuid },
      });

      // --- SCENARIO A: OVERRIDE UPDATE ---
      if (existingVisit) {
        const updatedVisit = await tx.laserVisit.update({
          where: { id: existingVisit.id },
          data: {
            status: payload.status || "Completed",
            completed:
              payload.completed !== undefined
                ? Boolean(payload.completed)
                : true,
            submittedAt: payload.submittedAt || existingVisit.submittedAt,
            dateOfService:
              payload.dateOfService ||
              payload.date_of_service ||
              existingVisit.dateOfService,
            artistName:
              payload.artistName ||
              payload.artist_name ||
              existingVisit.artistName,
            name: targetName,
            dob: payload.dob || existingVisit.dob,
            age: payload.age ? Number(payload.age) : existingVisit.age,
            gender: payload.gender || existingVisit.gender,
            occupation: payload.occupation || existingVisit.occupation,
            homeAddress:
              payload.homeAddress ||
              payload.home_address ||
              existingVisit.homeAddress,
            licenseNumber:
              payload.licenseNumber ||
              payload.license_number ||
              existingVisit.licenseNumber,
            country: resolvedCountry,
            state: resolvedState,
            zipCode:
              payload.zip_code || payload.zipCode || existingVisit.zipCode,
            phone: targetPhone,
            email: targetEmail,
            cityName: resolvedCityName,
            cityCountryCode:
              payload.city?.countryCode ||
              payload.cityCountryCode ||
              existingVisit.cityCountryCode,
            cityStateCode:
              payload.city?.stateCode ||
              payload.cityStateCode ||
              existingVisit.cityStateCode,
            cityLatitude:
              payload.city?.latitude ||
              payload.cityLatitude ||
              existingVisit.cityLatitude,
            cityLongitude:
              payload.city?.longitude ||
              payload.cityLongitude ||
              existingVisit.cityLongitude,
            emergencyContactName:
              payload.emergency_contact_name ||
              payload.emergencyContactName ||
              existingVisit.emergencyContactName,
            emergencyContactPhone:
              payload.emergency_contact_phone ||
              payload.emergencyContactPhone ||
              existingVisit.emergencyContactPhone,
            howDidYouHearAboutUs:
              payload.how_did_you_hear_about_us ||
              payload.howDidYouHearAboutUs ||
              existingVisit.howDidYouHearAboutUs,
            referredBy: payload.referredBy || existingVisit.referredBy,

            // Clean Image and Signature Assets Safely
            photoId: filterBase64(
              payload.photo_id || payload.photoId || existingVisit.photoId,
            ),
            proofUrl: filterBase64(
              payload.proof_url || payload.proofUrl || existingVisit.proofUrl,
            ),
            signatureUrl: filterBase64(
              payload.signatureUrl || existingVisit.signatureUrl,
            ),
            specialistSignature: filterBase64(
              payload.specialist_signature ||
                payload.specialistSignature ||
                existingVisit.specialistSignature,
            ),
            bodyDrawing: filterBase64(
              payload.body_drawing ||
                payload.bodyDrawing ||
                existingVisit.bodyDrawing,
            ),
            arrayProofOfOriginalPhoto: serializeArray(
              payload.array_proof_of_original_photo ||
                existingVisit.arrayProofOfOriginalPhoto,
            ),

            // Tattoo Profiling Mappings
            oldTattoo: serializeArray(
              payload.old_tattoo ||
                payload.oldTattoo ||
                existingVisit.oldTattoo,
            ),
            isItHomemade:
              payload.is_it_homemade ||
              payload.isItHomemade ||
              existingVisit.isItHomemade,
            shortDescription:
              payload.short_description ||
              payload.shortDescription ||
              existingVisit.shortDescription,
            tattooLocation:
              payload.tattoo_location ||
              payload.tattooLocation ||
              existingVisit.tattooLocation,
            tattooLocations:
              payload.tattooLocations || existingVisit.tattooLocations,
            tattooSizeCategory:
              payload.tattoo_size_category ||
              payload.tattooSizeCategory ||
              existingVisit.tattooSizeCategory,
            tattooIssueCosmetic:
              payload.tattoo_issue_cosmetic ||
              payload.tattooIssueCosmetic ||
              existingVisit.tattooIssueCosmetic,

            // Clinical Laser Calibration
            treatmentNumber: String(
              payload.treatment_number ||
                payload.treatmentNumber ||
                existingVisit.treatmentNumber,
            ),
            wavelength: String(payload.wavelength || existingVisit.wavelength),
            fluence: String(payload.fluence || existingVisit.fluence),
            tipSize: String(
              payload.tip_size || payload.tipSize || existingVisit.tipSize,
            ),
            treatmentArea:
              payload.treatment_area ||
              payload.treatmentArea ||
              existingVisit.treatmentArea,
            goodCandidate:
              payload.good_candidate ||
              payload.goodCandidate ||
              existingVisit.goodCandidate,
            medicalConditions: aggregatedMedicalConditions,
            otherHealthProblems: aggregatedHealthProblemsAndAnamnesis,
            skinType:
              payload.skin_type || payload.skinType || existingVisit.skinType,
            healingNotes: aggregatedTreatmentMetadataNotes,
            aftercareGiven:
              payload.aftercare_given ||
              payload.aftercareGiven ||
              existingVisit.aftercareGiven,

            // Financial Records
            feeCharged: String(
              payload.fee_charged ||
                payload.feeCharged ||
                existingVisit.feeCharged,
            ),
            amountPaid: String(
              payload.amount_paid ||
                payload.amountPaid ||
                existingVisit.amountPaid,
            ),
            balanceOwed: String(
              payload.balance_owed ||
                payload.balance_owed ||
                existingVisit.balanceOwed,
            ),
            priceGuaranteedRemoval: String(
              payload.price_guaranteed_removal ||
                payload.priceGuaranteedRemoval ||
                existingVisit.priceGuaranteedRemoval ||
                "",
            ),
            pricePerTreatment: String(
              payload.price_per_treatment ||
                payload.pricePerTreatment ||
                existingVisit.pricePerTreatment ||
                "",
            ),
            pricePackage3: String(
              payload.price_package_3 ||
                payload.pricePackage3 ||
                existingVisit.pricePackage3 ||
                "",
            ),
            pricePackage5: String(
              payload.price_package_5 ||
                payload.pricePackage5 ||
                existingVisit.pricePackage5 ||
                "",
            ),

            // Legal Consent Sign-offs
            authorizeName:
              payload.authorize_name ||
              payload.authorizeName ||
              existingVisit.authorizeName ||
              "",
            clinicName:
              payload.clinic_name ||
              payload.clinicName ||
              existingVisit.clinicName ||
              "Hyper Laser",
            releaseTo:
              payload.release_to ||
              payload.releaseTo ||
              existingVisit.releaseTo ||
              "Hyper Laser",
            clientDate:
              payload.client_date ||
              payload.clientDate ||
              existingVisit.clientDate ||
              "",
            specialistName:
              payload.specialist_name ||
              payload.specialistName ||
              existingVisit.specialistName ||
              "",
            specialistDate:
              payload.specialist_date ||
              payload.specialistDate ||
              existingVisit.specialistDate ||
              "",
          },
        });

        return {
          visit: updatedVisit,
          creditDeducted: false,
          profileCreated: false,
          isOverrideUpdate: true,
        };
      }

      // --- SCENARIO B: BRAND NEW VISIT FILE MATRIX ---
      let customer = await tx.laserCustomer.findUnique({
        where: { phoneNumber: targetPhone },
        include: {
          packages: {
            where: { remainingCredits: { gt: 0 }, status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      let profileCreated = false;
      if (!customer) {
        customer = await tx.laserCustomer.create({
          data: {
            name: targetName,
            phoneNumber: targetPhone,
            email: targetEmail,
          },
          include: { packages: true },
        });
        profileCreated = true;
      }

      let creditDeducted = false;
      let fallbackUsageInfo = "UNPAID";
      let activePackageInstance = null;

      if (customer.packages && customer.packages.length > 0) {
        activePackageInstance = customer.packages[0];
        const nextCreditBalance = activePackageInstance.remainingCredits - 1;

        await tx.laserCustomerPackage.update({
          where: { id: activePackageInstance.id },
          data: {
            remainingCredits: nextCreditBalance,
            status: nextCreditBalance === 0 ? "EXPIRED" : "ACTIVE",
          },
        });

        creditDeducted = true;
        fallbackUsageInfo = `PAID_VIA_${activePackageInstance.id}`;
      }

      const finalNotes =
        fallbackUsageInfo + "\n" + aggregatedTreatmentMetadataNotes;

      const newVisit = await tx.laserVisit.create({
        data: {
          customerId: customer.id,
          uuid: clientUuid,
          status: payload.status || "Completed",
          completed:
            payload.completed !== undefined ? Boolean(payload.completed) : true,
          submittedAt: payload.submittedAt || new Date().toISOString(),
          dateOfService:
            payload.dateOfService ||
            payload.date_of_service ||
            new Date().toLocaleDateString(),
          artistName: payload.artistName || payload.artist_name || "",
          name: targetName,
          dob: payload.dob || "",
          age: payload.age ? Number(payload.age) : null,
          gender: payload.gender || "",
          occupation: payload.occupation || "",
          homeAddress: payload.home_address || payload.homeAddress || "",
          licenseNumber: payload.license_number || payload.licenseNumber || "",
          country: resolvedCountry,
          state: resolvedState,
          zipCode: payload.zip_code || payload.zipCode || "",
          phone: targetPhone,
          email: targetEmail,
          cityName: resolvedCityName,
          cityCountryCode:
            payload.city?.countryCode || payload.cityCountryCode || "",
          cityStateCode: payload.city?.stateCode || payload.cityStateCode || "",
          cityLatitude: payload.city?.latitude || payload.cityLatitude || "",
          cityLongitude: payload.city?.longitude || payload.cityLongitude || "",
          emergencyContactName:
            payload.emergency_contact_name ||
            payload.emergencyContactName ||
            "",
          emergencyContactPhone:
            payload.emergency_contact_phone ||
            payload.emergencyContactPhone ||
            "",
          howDidYouHearAboutUs:
            payload.how_did_you_hear_about_us ||
            payload.howDidYouHearAboutUs ||
            "",
          referredBy: payload.referredBy || "",

          // Media url cloud uploads
          photoId: filterBase64(payload.photo_id || payload.photoId),
          proofUrl: filterBase64(payload.proof_url || payload.proofUrl),
          signatureUrl: filterBase64(payload.signatureUrl),
          specialistSignature: filterBase64(
            payload.specialist_signature || payload.specialistSignature,
          ),
          bodyDrawing: filterBase64(
            payload.body_drawing || payload.bodyDrawing,
          ),
          arrayProofOfOriginalPhoto: serializeArray(
            payload.array_proof_of_original_photo,
          ),

          // Tattoo parameters
          oldTattoo: serializeArray(payload.old_tattoo || payload.oldTattoo),
          isItHomemade: payload.is_it_homemade || payload.isItHomemade || "",
          shortDescription:
            payload.short_description || payload.shortDescription || "",
          tattooLocation:
            payload.tattoo_location || payload.tattooLocation || "",
          tattooLocations:
            payload.tattooLocations || payload.tattooLocations || "",
          tattooSizeCategory:
            payload.tattoo_size_category || payload.tattooSizeCategory || "",
          tattooIssueCosmetic:
            payload.tattoo_issue_cosmetic || payload.tattooIssueCosmetic || "",

          // Calibration metrics
          treatmentNumber: String(
            payload.treatment_number || payload.treatmentNumber || "1",
          ),
          wavelength: String(payload.wavelength || ""),
          fluence: String(payload.fluence || ""),
          tipSize: String(payload.tip_size || payload.tipSize || ""),
          treatmentArea: payload.treatment_area || payload.treatmentArea || "",
          goodCandidate: payload.good_candidate || payload.goodCandidate || "",
          medicalConditions: aggregatedMedicalConditions,
          otherHealthProblems: aggregatedHealthProblemsAndAnamnesis,
          skinType: payload.skin_type || payload.skinType || "",
          healingNotes: finalNotes,
          aftercareGiven:
            payload.aftercare_given || payload.aftercareGiven || "",

          // Accounting balances
          feeCharged: String(payload.fee_charged || payload.feeCharged || ""),
          amountPaid: String(payload.amount_paid || payload.amountPaid || ""),
          balanceOwed: String(
            payload.balance_owed || payload.balanceOwed || "",
          ),
          priceGuaranteedRemoval: String(
            payload.price_guaranteed_removal ||
              payload.priceGuaranteedRemoval ||
              "",
          ),
          pricePerTreatment: String(
            payload.price_per_treatment || payload.pricePerTreatment || "",
          ),
          pricePackage3: String(
            payload.price_package_3 || payload.pricePackage3 || "",
          ),
          pricePackage5: String(
            payload.price_package_5 || payload.pricePackage5 || "",
          ),

          // Legal Signatures
          authorizeName: payload.authorize_name || payload.authorizeName || "",
          clinicName:
            payload.clinic_name || payload.clinicName || "Hyper Laser",
          releaseTo: payload.release_to || payload.releaseTo || "Hyper Laser",
          clientDate: payload.client_date || payload.clientDate || "",
          specialistName:
            payload.specialist_name || payload.specialistName || "",
          specialistDate:
            payload.specialist_date || payload.specialistDate || "",
        },
      });

      // Explicitly map usage mapping history relation to link LaserVisit with Package model
      // Explicitly map usage mapping history relation to link LaserVisit with Package model
      if (creditDeducted && activePackageInstance) {
        await tx.laserVisitPackageUsage.create({
          data: {
            visitId: newVisit.id,
            customerPackageId: activePackageInstance.id,
            creditsDeducted: 1, // Changed from creditsUsed
            usedAt: new Date(), // Changed from loggedAt (or you can omit this entirely since it defaults to now())
          },
        });
      }

      return {
        visit: newVisit,
        creditDeducted,
        profileCreated,
        isOverrideUpdate: false,
      };
    });

    return res.json({
      message: result.isOverrideUpdate
        ? "Visit modifications successfully synchronized. No credits were re-deducted."
        : result.creditDeducted
          ? "First sync registered. 1 Package credit consumed and mapped successfully."
          : "Visit logged. Client profile does not own any valid package credits. Requires manual resolution.",
      visit: result.visit,
      creditDeducted: result.creditDeducted,
      profileCreated: result.profileCreated,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// 5. GET THE LATEST 50 VISITS LOGS ENDPOINT
export const getLatestVisitsLogs = async (req: Request, res: Response) => {
  try {
    const visits = await prisma.laserVisit.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          include: { packages: true },
        },
      },
    });
    return res.json(visits);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getListOfVisitAndHistoryUsageByLaserCustomerId = async (
  req: Request,
  res: Response,
) => {
  try {
    const customerId = req.query.customerId as string;

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required." });
    }

    const customerData = await prisma.laserCustomer.findUnique({
      where: { id: customerId },
      include: {
        packages: true, // This likely contains the price info
        visits: {
          orderBy: { submittedAt: "desc" },
          include: {
            packageUsages: {
              include: { customerPackage: true },
            },
          },
        },
      },
    });

    if (!customerData) {
      return res.status(404).json({ message: "Customer not found." });
    }

    const formattedVisits = customerData.visits.map((visit) => {
      const notes = visit.healingNotes || "";
      let paymentStatus = "MANUAL_RESOLUTION_REQUIRED";
      let deductedPackageId: string | null = null;
      let matchedPackage: any = null;

      let costPerCredit = 0;
      let totalDeductedValue = 0;
      let initialCredits = 0;
      let remainingCredits = 0;
      let packagePrice = 0;

      const primaryUsageRecord = visit.packageUsages?.[0];

      // Logic to resolve the package and its price
      if (primaryUsageRecord || notes.startsWith("PAID_VIA_")) {
        const pId =
          primaryUsageRecord?.customerPackage?.packageId ||
          notes.split("\n")[0].replace("PAID_VIA_", "").trim();

        deductedPackageId = pId;
        // Lookup the definition from customerData.packages to get the price
        matchedPackage =
          customerData.packages.find((p) => p.id === pId) ||
          primaryUsageRecord?.customerPackage;

        if (matchedPackage) {
          // KEY FIX: Explicitly looking for 'price' or 'packageOriginalPrice'
          // If your DB field is different (e.g. 'amount'), change this line:
          packagePrice = Number(
            matchedPackage.price ||
              matchedPackage.packageOriginalPrice ||
              matchedPackage.totalPaid ||
              200, // <--- Fallback for testing if field is truly missing
          );

          initialCredits =
            matchedPackage.totalCredits || matchedPackage.initialCredits || 1;
          remainingCredits = matchedPackage.remainingCredits ?? 0;

          if (packagePrice > 0 && initialCredits > 0) {
            costPerCredit = packagePrice / initialCredits;
            totalDeductedValue =
              costPerCredit * (primaryUsageRecord?.creditsDeducted || 1);
          }
          paymentStatus = "PACKAGE_CREDIT_DEDUCTED";
        }
      }

      return {
        ...visit,
        visitId: visit.id,
        usageHistory: {
          status: paymentStatus,
          packageId: deductedPackageId,
          packageName: matchedPackage?.packageName || "Package Plan",
          financials: {
            packageOriginalPrice: packagePrice,
            totalAllocatedCredits: initialCredits,
            remainingPackageCredits: remainingCredits,
            calculatedCostPerCredit: costPerCredit,
            valueDeductedThisVisit: totalDeductedValue,
          },
        },
        clinicalDetails: {
          wavelength: visit.wavelength,
          fluence: visit.fluence,
          tipSize: visit.tipSize,
          healingNotes: notes.startsWith("PAID_VIA_")
            ? notes.split("\n").slice(1).join("\n")
            : notes,
        },
      };
    });

    return res.json({
      customer: { id: customerData.id, name: customerData.name },
      visits: formattedVisits,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
// 1. Purchase for specific customer
export const purchasePackageForCustomer = async (
  req: Request,
  res: Response,
) => {
  const { customerId, packageId, paymentMethod } = req.body;
  const staffId = (req as any).user?.userId;

  const basePackage = await prisma.package.findUnique({
    where: { id: packageId },
  });

  const record = await prisma.laserCustomerPackage.create({
    data: {
      customerId,
      packageId,
      totalCredits: basePackage!.credit,
      remainingCredits: basePackage!.credit,
      paymentMethod,
      soldById: staffId,
    },
  });
  res.json(record);
};

export const settleVisitWithPackage = async (req: Request, res: Response) => {
  try {
    const { visitId, customerPackageId } = req.body;

    if (!visitId || !customerPackageId) {
      return res
        .status(400)
        .json({ message: "Visit ID and Package ID are required." });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify the package exists and has credits
      const pkg = await tx.laserCustomerPackage.findUnique({
        where: { id: customerPackageId },
      });

      if (!pkg || pkg.remainingCredits <= 0) {
        throw new Error("Package not found or insufficient credits.");
      }

      // 2. Fetch existing visit to handle the note replacement
      const visit = await tx.laserVisit.findUnique({
        where: { id: visitId },
        select: { healingNotes: true },
      });

      if (!visit) throw new Error("Visit not found.");

      // 3. Deduct the credit
      const nextCreditBalance = pkg.remainingCredits - 1;
      await tx.laserCustomerPackage.update({
        where: { id: customerPackageId },
        data: {
          remainingCredits: nextCreditBalance,
          status: nextCreditBalance === 0 ? "EXPIRED" : "ACTIVE",
        },
      });

      // 4. Create the usage mapping
      const usage = await tx.laserVisitPackageUsage.create({
        data: {
          visitId: visitId,
          customerPackageId: customerPackageId,
          creditsDeducted: 1,
          usedAt: new Date(),
        },
      });

      // 5. Update the visit notes (string replacement)
      const updatedNotes = visit.healingNotes.replace(
        "UNPAID",
        `PAID_VIA_${customerPackageId}`,
      );

      const updatedVisit = await tx.laserVisit.update({
        where: { id: visitId },
        data: { healingNotes: updatedNotes },
      });

      return { usage, updatedVisit };
    });

    return res.json({
      message: "Visit settled successfully. Credit deducted.",
      usage: result.usage,
      visit: result.updatedVisit,
    });
  } catch (error: any) {
    console.error("Settlement Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
