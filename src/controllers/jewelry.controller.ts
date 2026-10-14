import { Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { imageKit } from "../utils/imagekit";

const prisma = new PrismaClient();

const MAX_LIMIT = 100;

// ---------- helpers ----------

function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, message });
}

function handleError(res: Response, error: unknown, label: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return fail(res, 409, "A category with this name already exists");
    if (error.code === "P2025") return fail(res, 404, "Not found");
  }
  console.error(`${label} error:`, error);
  return fail(res, 500, error instanceof Error ? error.message : "An unknown error occurred");
}

function pagination(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

// Photos are uploaded straight to ImageKit by the mobile app,
// so only accept URLs served by ImageKit (or our configured ImageKit endpoint).
function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  if (endpoint && url.startsWith(endpoint)) return true;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname === "ik.imagekit.io";
  } catch {
    return false;
  }
}

function parsePrice(value: unknown): number | null {
  const n = Number(value);
  if (value === "" || value === null || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parseIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v)) return null;
  return [...new Set(value as string[])];
}

async function deleteImageKitFile(fileId?: string | null) {
  if (!fileId) return;
  try {
    await imageKit.deleteFile(fileId);
  } catch (error) {
    console.error(`ImageKit delete failed for ${fileId}:`, error);
  }
}

async function findMissingIds(categoryIds: string[], itemIds: string[]) {
  const [categories, items] = await Promise.all([
    prisma.jewelryCategory.count({ where: { id: { in: categoryIds } } }),
    prisma.jewelryItem.count({ where: { id: { in: itemIds } } }),
  ]);
  if (categories !== categoryIds.length) return "One or more categories do not exist";
  if (items !== itemIds.length) return "One or more jewelry items do not exist";
  return null;
}

const itemSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  photoUrl: true,
} satisfies Prisma.JewelryItemSelect;

const demoPhotoInclude = {
  categories: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  items: { select: itemSelect, orderBy: { name: "asc" } },
} satisfies Prisma.DemoPhotoInclude;

// ---------- categories ----------

export const listCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.jewelryCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { demoPhotos: true } } },
    });
    return res.json({
      success: true,
      categories: categories.map(({ _count, ...c }) => ({
        ...c,
        demoPhotoCount: _count.demoPhotos,
      })),
    });
  } catch (error) {
    return handleError(res, error, "List categories");
  }
};

export const createCategory = async (req: Request, res: Response) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) return fail(res, 400, "Category name is required");
  try {
    const category = await prisma.jewelryCategory.create({ data: { name } });
    return res.status(201).json({ success: true, category });
  } catch (error) {
    return handleError(res, error, "Create category");
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) return fail(res, 400, "Category name is required");
  try {
    const category = await prisma.jewelryCategory.update({
      where: { id: req.params.id },
      data: { name },
    });
    return res.json({ success: true, category });
  } catch (error) {
    return handleError(res, error, "Update category");
  }
};

// Deleting a category only unlinks it from demo photos; the photos stay.
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    await prisma.jewelryCategory.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (error) {
    return handleError(res, error, "Delete category");
  }
};

// ---------- jewelry items ----------

export const listItems = async (req: Request, res: Response) => {
  const { page, limit, skip } = pagination(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.JewelryItemWhereInput = search
    ? { name: { contains: search, mode: "insensitive" } }
    : {};
  try {
    const [items, total] = await prisma.$transaction([
      prisma.jewelryItem.findMany({
        where,
        select: { ...itemSelect, createdAt: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.jewelryItem.count({ where }),
    ]);
    return res.json({ success: true, items, page, limit, total });
  } catch (error) {
    return handleError(res, error, "List items");
  }
};

// One item plus the demo photos it appears in.
export const getItem = async (req: Request, res: Response) => {
  try {
    const item = await prisma.jewelryItem.findUnique({
      where: { id: req.params.id },
      select: {
        ...itemSelect,
        createdAt: true,
        demoPhotos: {
          select: { id: true, photoUrl: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!item) return fail(res, 404, "Jewelry item not found");
    return res.json({ success: true, item });
  } catch (error) {
    return handleError(res, error, "Get item");
  }
};

export const createItem = async (req: Request, res: Response) => {
  const { name, description, price, photoUrl, photoFileId } = req.body;
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanPrice = parsePrice(price);

  if (!cleanName) return fail(res, 400, "Name is required");
  if (cleanPrice === null) return fail(res, 400, "Price must be a number of 0 or more");
  if (!isValidPhotoUrl(photoUrl)) return fail(res, 400, "A valid photo URL is required");

  try {
    const item = await prisma.jewelryItem.create({
      data: {
        name: cleanName,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        price: cleanPrice,
        photoUrl,
        photoFileId: typeof photoFileId === "string" ? photoFileId : null,
      },
    });
    return res.status(201).json({ success: true, item });
  } catch (error) {
    return handleError(res, error, "Create item");
  }
};

// Partial update: only the fields sent are changed.
export const updateItem = async (req: Request, res: Response) => {
  const { name, description, price, photoUrl, photoFileId } = req.body;
  const data: Prisma.JewelryItemUpdateInput = {};

  if (name !== undefined) {
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) return fail(res, 400, "Name cannot be empty");
    data.name = cleanName;
  }
  if (description !== undefined) {
    data.description = typeof description === "string" && description.trim() ? description.trim() : null;
  }
  if (price !== undefined) {
    const cleanPrice = parsePrice(price);
    if (cleanPrice === null) return fail(res, 400, "Price must be a number of 0 or more");
    data.price = cleanPrice;
  }
  if (photoUrl !== undefined) {
    if (!isValidPhotoUrl(photoUrl)) return fail(res, 400, "A valid photo URL is required");
    data.photoUrl = photoUrl;
    data.photoFileId = typeof photoFileId === "string" ? photoFileId : null;
  }

  try {
    const existing = await prisma.jewelryItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, "Jewelry item not found");

    const item = await prisma.jewelryItem.update({ where: { id: existing.id }, data });
    if (photoUrl !== undefined && existing.photoFileId !== item.photoFileId) {
      await deleteImageKitFile(existing.photoFileId);
    }
    return res.json({ success: true, item });
  } catch (error) {
    return handleError(res, error, "Update item");
  }
};

// Deleting an item only unlinks it from demo photos; the photos stay.
export const deleteItem = async (req: Request, res: Response) => {
  try {
    const item = await prisma.jewelryItem.delete({ where: { id: req.params.id } });
    await deleteImageKitFile(item.photoFileId);
    return res.json({ success: true });
  } catch (error) {
    return handleError(res, error, "Delete item");
  }
};

// ---------- demo photos ----------

export const listDemoPhotos = async (req: Request, res: Response) => {
  const { page, limit, skip } = pagination(req);
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : "";
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";

  const where: Prisma.DemoPhotoWhereInput = {
    ...(categoryId && { categories: { some: { id: categoryId } } }),
    ...(itemId && { items: { some: { id: itemId } } }),
  };

  try {
    const [demoPhotos, total] = await prisma.$transaction([
      prisma.demoPhoto.findMany({
        where,
        include: demoPhotoInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.demoPhoto.count({ where }),
    ]);
    return res.json({ success: true, demoPhotos, page, limit, total });
  } catch (error) {
    return handleError(res, error, "List demo photos");
  }
};

export const getDemoPhoto = async (req: Request, res: Response) => {
  try {
    const demoPhoto = await prisma.demoPhoto.findUnique({
      where: { id: req.params.id },
      include: demoPhotoInclude,
    });
    if (!demoPhoto) return fail(res, 404, "Demo photo not found");
    return res.json({ success: true, demoPhoto });
  } catch (error) {
    return handleError(res, error, "Get demo photo");
  }
};

export const createDemoPhoto = async (req: Request, res: Response) => {
  const { photoUrl, photoFileId } = req.body;
  const categoryIds = parseIds(req.body.categoryIds);
  const itemIds = parseIds(req.body.itemIds);

  if (!isValidPhotoUrl(photoUrl)) return fail(res, 400, "A valid photo URL is required");
  if (!categoryIds || !itemIds) return fail(res, 400, "categoryIds and itemIds must be arrays of ids");

  try {
    const missing = await findMissingIds(categoryIds, itemIds);
    if (missing) return fail(res, 400, missing);

    const demoPhoto = await prisma.demoPhoto.create({
      data: {
        photoUrl,
        photoFileId: typeof photoFileId === "string" ? photoFileId : null,
        categories: { connect: categoryIds.map((id) => ({ id })) },
        items: { connect: itemIds.map((id) => ({ id })) },
      },
      include: demoPhotoInclude,
    });
    return res.status(201).json({ success: true, demoPhoto });
  } catch (error) {
    return handleError(res, error, "Create demo photo");
  }
};

// Partial update. categoryIds / itemIds, when sent, replace the full list of links.
export const updateDemoPhoto = async (req: Request, res: Response) => {
  const { photoUrl, photoFileId } = req.body;
  const categoryIds = req.body.categoryIds === undefined ? undefined : parseIds(req.body.categoryIds);
  const itemIds = req.body.itemIds === undefined ? undefined : parseIds(req.body.itemIds);

  if (photoUrl !== undefined && !isValidPhotoUrl(photoUrl)) {
    return fail(res, 400, "A valid photo URL is required");
  }
  if (categoryIds === null || itemIds === null) {
    return fail(res, 400, "categoryIds and itemIds must be arrays of ids");
  }

  try {
    const existing = await prisma.demoPhoto.findUnique({ where: { id: req.params.id } });
    if (!existing) return fail(res, 404, "Demo photo not found");

    const missing = await findMissingIds(categoryIds ?? [], itemIds ?? []);
    if (missing) return fail(res, 400, missing);

    const demoPhoto = await prisma.demoPhoto.update({
      where: { id: existing.id },
      data: {
        ...(photoUrl !== undefined && {
          photoUrl,
          photoFileId: typeof photoFileId === "string" ? photoFileId : null,
        }),
        ...(categoryIds && { categories: { set: categoryIds.map((id) => ({ id })) } }),
        ...(itemIds && { items: { set: itemIds.map((id) => ({ id })) } }),
      },
      include: demoPhotoInclude,
    });
    if (photoUrl !== undefined && existing.photoFileId !== demoPhoto.photoFileId) {
      await deleteImageKitFile(existing.photoFileId);
    }
    return res.json({ success: true, demoPhoto });
  } catch (error) {
    return handleError(res, error, "Update demo photo");
  }
};

export const deleteDemoPhoto = async (req: Request, res: Response) => {
  try {
    const demoPhoto = await prisma.demoPhoto.delete({ where: { id: req.params.id } });
    await deleteImageKitFile(demoPhoto.photoFileId);
    return res.json({ success: true });
  } catch (error) {
    return handleError(res, error, "Delete demo photo");
  }
};
