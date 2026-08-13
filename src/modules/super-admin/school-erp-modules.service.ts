import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolErpModulesService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async findAll() {
    const modules: any[] = await this.ds.query(
      `SELECT * FROM school_erp_modules WHERE is_active = true ORDER BY sort_order ASC`
    );
    return { success: true, data: modules };
  }

  async create(dto: {
    key: string;
    name: string;
    description?: string;
    path?: string;
    icon: string;
    color: string;
    sort_order?: number;
  }) {
    const rows = await this.ds.query(
      `INSERT INTO school_erp_modules (key, name, description, path, icon, color, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [dto.key, dto.name, dto.description || null, dto.path || null, dto.icon, dto.color, dto.sort_order || 0]
    );
    return { success: true, data: rows[0] };
  }

  async update(id: string, dto: Partial<{
    name: string;
    description: string;
    path: string;
    icon: string;
    color: string;
    sort_order: number;
    is_active: boolean;
  }>) {
    const existing = await this.ds.query(`SELECT * FROM school_erp_modules WHERE id = $1`, [id]);
    if (!existing.length) throw new NotFoundException('Module not found');

    const e = existing[0];
    const name = dto.name ?? e.name;
    const description = dto.description ?? e.description;
    const path = dto.path !== undefined ? dto.path : e.path;
    const icon = dto.icon ?? e.icon;
    const color = dto.color ?? e.color;
    const sort_order = dto.sort_order ?? e.sort_order;
    const is_active = dto.is_active ?? e.is_active;

    const rows = await this.ds.query(
      `UPDATE school_erp_modules 
       SET name = $1, description = $2, path = $3, icon = $4, color = $5, sort_order = $6, is_active = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name, description, path, icon, color, sort_order, is_active, id]
    );
    return { success: true, data: rows[0] };
  }

  async getAssignments(schoolId: string) {
    // Get all active modules and join with assignments for this school
    const modules = await this.ds.query(`
      SELECT 
        m.id as module_id, 
        m.key, 
        m.name, 
        m.description, 
        m.path, 
        m.icon, 
        m.color,
        m.sort_order,
        COALESCE(a.is_active, false) as is_assigned
      FROM school_erp_modules m
      LEFT JOIN school_erp_module_assignments a 
        ON m.id = a.module_id AND a.school_id = $1
      WHERE m.is_active = true
      ORDER BY m.sort_order ASC
    `, [schoolId]);

    return { success: true, data: modules };
  }

  async toggleAssignment(schoolId: string, moduleId: string, is_active: boolean) {
    // Upsert the assignment
    await this.ds.query(`
      INSERT INTO school_erp_module_assignments (school_id, module_id, is_active)
      VALUES ($1, $2, $3)
      ON CONFLICT (school_id, module_id) 
      DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW()
    `, [schoolId, moduleId, is_active]);

    return { success: true };
  }

  async getInstituteModules(schoolId: string) {
    // Get modules assigned and active for a school
    const modules = await this.ds.query(`
      SELECT 
        m.id, 
        m.key, 
        m.name, 
        m.description, 
        m.path, 
        m.icon, 
        m.color,
        m.sort_order
      FROM school_erp_modules m
      INNER JOIN school_erp_module_assignments a 
        ON m.id = a.module_id
      WHERE a.school_id = $1 
        AND a.is_active = true 
        AND m.is_active = true
      ORDER BY m.sort_order ASC
    `, [schoolId]);

    return { success: true, data: modules };
  }
}
