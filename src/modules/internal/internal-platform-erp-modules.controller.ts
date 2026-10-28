import { Body, ConflictException, Controller, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Max, Min, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { assertInternalKey } from './internal-key';

/** The colours the LMS super admin's module form offers. The seeded modules store a hex colour instead, so both are accepted. */
export const ERP_MODULE_COLORS = ['indigo', 'blue', 'sky', 'emerald', 'teal', 'rose', 'amber', 'purple', 'fuchsia', 'slate'] as const;
const COLOR = /^(#[0-9a-fA-F]{6}|indigo|blue|sky|emerald|teal|rose|amber|purple|fuchsia|slate)$/;
/** The form stores PascalCase names (ShoppingCart); the seeded modules use kebab-case (shopping-cart). */
const ICON = /^[A-Za-z0-9-]{2,40}$/;

export class CreateErpModuleDto {
  /** The slug schools are assigned by (e.g. "inventory"). It cannot be changed afterwards. */
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'key must be lowercase letters, digits and hyphens' }) @MaxLength(40) key: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  /** The ERP route this module opens, e.g. "/inventory". Empty means "coming soon": the ERP will not show it. */
  @IsOptional() @Matches(/^\/[A-Za-z0-9\-_/]*$/, { message: 'path must start with / and contain only letters, digits, - _ /' }) @MaxLength(120) path?: string;
  @Matches(ICON, { message: 'icon must be an icon name' }) icon: string;
  @Matches(COLOR, { message: 'color must be a theme colour name or a #rrggbb value' }) color: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class UpdateErpModuleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Matches(/^(\/[A-Za-z0-9\-_/]*)?$/, { message: 'path must start with / and contain only letters, digits, - _ /' }) @MaxLength(120) path?: string;
  @IsOptional() @Matches(ICON, { message: 'icon must be an icon name' }) icon?: string;
  @IsOptional() @Matches(COLOR, { message: 'color must be a theme colour name or a #rrggbb value' }) color?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

const SELECT = `m.id::text AS id, m.key, m.name, m.description, m.path, m.icon, m.color, m.sort_order AS "sortOrder", m.is_active AS "isActive",
  (SELECT COUNT(*)::int FROM school_erp_module_assignments a WHERE a.module_id = m.id AND a.is_active) AS schools`;

/**
 * The ERP module catalogue for the platform console: the same `school_erp_modules` the LMS super admin's "ERP Modules
 * Master" edits. The ERP shows a school only the modules whose path is assigned to it and active here, so a change
 * to a module's path or active flag changes the menu of every school that has it.
 */
@Controller('internal/platform/erp-modules')
export class InternalPlatformErpModulesController {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  @Get()
  list(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    return this.ds.query(`SELECT ${SELECT} FROM school_erp_modules m ORDER BY m.sort_order ASC, m.name ASC`);
  }

  @Post()
  @HttpCode(201)
  async create(@Headers('x-internal-key') key: string, @Body() dto: CreateErpModuleDto) {
    assertInternalKey(key);
    const [taken] = await this.ds.query(`SELECT 1 AS x FROM school_erp_modules WHERE key = $1`, [dto.key]);
    if (taken) throw new ConflictException(`A module with the key "${dto.key}" already exists`);
    const [row] = await this.ds.query(
      `INSERT INTO school_erp_modules (key, name, description, path, icon, color, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id`,
      [dto.key, dto.name.trim(), dto.description?.trim() || null, dto.path || null, dto.icon, dto.color, dto.sortOrder ?? 0],
    );
    const [created] = await this.ds.query(`SELECT ${SELECT} FROM school_erp_modules m WHERE m.id::text = $1`, [row.id]);
    return created;
  }

  @Put(':id')
  @HttpCode(200)
  async update(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateErpModuleDto) {
    assertInternalKey(key);
    const [existing] = await this.ds.query(`SELECT * FROM school_erp_modules WHERE id::text = $1`, [id]);
    if (!existing) throw new NotFoundException('Module not found');
    await this.ds.query(
      `UPDATE school_erp_modules SET name = $1, description = $2, path = $3, icon = $4, color = $5, sort_order = $6, is_active = $7, updated_at = NOW() WHERE id::text = $8`,
      [
        dto.name?.trim() ?? existing.name,
        dto.description !== undefined ? dto.description.trim() || null : existing.description,
        dto.path !== undefined ? dto.path || null : existing.path,
        dto.icon ?? existing.icon,
        dto.color ?? existing.color,
        dto.sortOrder ?? existing.sort_order,
        dto.isActive ?? existing.is_active,
        id,
      ],
    );
    const [updated] = await this.ds.query(`SELECT ${SELECT} FROM school_erp_modules m WHERE m.id::text = $1`, [id]);
    return updated;
  }
}
