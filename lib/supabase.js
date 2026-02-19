import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

export async function createUserIfNotExists(data) {
	const { data: existing } = await supabase
		.from("users")
		.select("id")
		.eq("display_id", data.display_id)
		.single();

	if (!existing) {
		await supabase.from("users").insert([
			{
				display_id: data.display_id,
				type: data.type,
				phone: data.phone,
				created_at: new Date(),
			},
		]);
	}
}

export default supabase;
